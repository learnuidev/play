#!/usr/bin/env node
/**
 * Points the Cognito user pool's pre sign-up trigger at the CDK-managed Lambda.
 *
 * ## Why this is a script and not a deployment
 *
 * The user pool is **imported** by `PlayAuthStack`, and an imported resource is
 * unmanaged: CloudFormation will not change its properties, so the stack cannot
 * set `LambdaConfig.PreSignUp` even though it deploys the function that trigger
 * calls. Setting it means calling `UpdateUserPool`, once, and this is that call.
 *
 * It has to run **after the CDK stacks are deployed and before the legacy stack
 * is deleted**. Until the legacy stack is gone, the pool's trigger points at the
 * old stack's `link-federated-user`; deleting that stack without running this
 * leaves the pool calling a function that no longer exists, and the failure is
 * not a 500 — it is *sign-up*, which stops working for everybody.
 *
 * ## What it changes, and what it does not
 *
 * One field. `UpdateUserPool` replaces the configuration it is given rather than
 * patching it, so this reads the pool first and sends back everything the API
 * accepts, with `PreSignUp` swapped. That matters because the pool carries
 * password policy, MFA settings, auto-verification and admin-create behaviour
 * that nothing else in this repository declares — dropping one of them would be
 * a silent change to how people sign in.
 *
 * It is idempotent, and `--show` prints what it would do without doing it.
 *
 * Usage:
 *   node scripts/adopt-cognito.mjs [options]
 *
 * Options:
 *   --stage=<name>    Backend stage   (default: dev)
 *   --profile=<name>  AWS profile     (default: scripts/api-config.env)
 *   --region=<name>   AWS region      (default: us-east-1)
 *   --show            Print the current state and the target, change nothing
 *   --detach          Remove the trigger entirely (a pool with Google disabled)
 *   --help            Show this help
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INFRA = path.resolve(HERE, '..');
const ROOT = path.resolve(INFRA, '..');
const args = process.argv.slice(2);

/**
 * Prints the block comment at the top of this file.
 *
 * Read from the source rather than kept as a second copy beside it, so the help
 * cannot drift from the explanation somebody reads when they open the file.
 */
function usage() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');

  // Skip the shebang, then print the leading `/** … *\/` block with its markers
  // stripped. Anything before that block, or after it, is not help text.
  let started = false;
  for (const line of lines.slice(1)) {
    if (!started) {
      if (!line.trimStart().startsWith('/**')) continue;
      started = true;
      continue;
    }
    if (line.trimStart().startsWith('*/')) break;
    console.log(line.replace(/^\s*\*\s?/, ''));
  }
}

if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

const getArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

function readApiConfig() {
  const file = path.join(ROOT, 'scripts', 'api-config.env');
  const config = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const separator = text.indexOf('=');
    if (separator === -1) continue;
    config[text.slice(0, separator).trim()] = text.slice(separator + 1).trim();
  }
  return config;
}

const stage = getArg('stage', process.env.STAGE || 'dev');
const region = getArg('region', process.env.AWS_REGION || 'us-east-1');
const profile = getArg('profile', process.env.AWS_PROFILE || readApiConfig().API_AWS_PROFILE);
const show = args.includes('--show');
const detach = args.includes('--detach');

const config = JSON.parse(
  fs.readFileSync(path.join(INFRA, 'config', `play-${stage}.json`), 'utf8'),
);
const userPoolId = config.existing.userPoolId;

function aws(argv, { optional = false } = {}) {
  try {
    const out = execFileSync(
      'aws',
      [...argv, '--profile', profile, '--region', region, '--output', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    // `update-user-pool` answers with an empty body on success, and the CLI
    // passes that through as zero bytes rather than as `{}`. Reading it as JSON
    // would throw *after* the update had already been applied, which is a
    // failure report for something that worked.
    if (out.trim() === '') return {};

    return JSON.parse(out);
  } catch (err) {
    if (optional) return undefined;
    throw new Error(`aws ${argv.join(' ')}\n${err.stderr ? String(err.stderr).trim() : err.message}`);
  }
}

// The new function's ARN, from the stack that deployed it. Read rather than
// assumed: CloudFormation appends nothing to an explicit name, but the stack is
// the authority and a renamed construct would otherwise be a wrong guess.
const authStack = aws([
  'cloudformation',
  'describe-stacks',
  '--stack-name',
  `PlayAuthStack-${stage}`,
]).Stacks[0];

const outputs = {};
for (const output of authStack.Outputs ?? []) outputs[output.OutputKey] = output.OutputValue;

const targetArn = outputs.LinkFederatedUserFunctionArn;
if (!targetArn) {
  throw new Error(
    `PlayAuthStack-${stage} has no LinkFederatedUserFunctionArn output. ` +
      'Deploy the CDK stacks first: npm run deploy --workspace play-infra',
  );
}

const pool = aws(['cognito-idp', 'describe-user-pool', '--user-pool-id', userPoolId]).UserPool;
const current = pool.LambdaConfig?.PreSignUp;

console.log(`Pool        ${userPoolId} (${profile}, ${region})`);
console.log(`PreSignUp   ${current ?? '(not set)'}`);

if (show) {
  console.log(`${detach ? 'Would clear' : 'Would set to'}  ${detach ? '' : targetArn}`);
  process.exit(0);
}

if (detach && !current) {
  console.log('\nAlready unset — nothing to do.');
  process.exit(0);
}
if (!detach && current === targetArn) {
  console.log('\nAlready points at the CDK function — nothing to do.');
  process.exit(0);
}

/**
 * The fields `UpdateUserPool` accepts.
 *
 * A whitelist rather than a delete-list, because `DescribeUserPool` returns
 * fields the update API rejects — `Arn`, `EstimatedNumberOfUsers`,
 * `SchemaAttributes`, `UsernameAttributes` and the `*ConfigurationFailure`
 * pairs — and sending one is an error rather than something ignored.
 */
const UPDATABLE = [
  'Policies',
  'DeletionProtection',
  'LambdaConfig',
  'AutoVerifiedAttributes',
  'SmsVerificationMessage',
  'EmailVerificationMessage',
  'EmailVerificationSubject',
  'VerificationMessageTemplate',
  'SmsAuthenticationMessage',
  'UserAttributeUpdateSettings',
  'MfaConfiguration',
  'DeviceConfiguration',
  'EmailConfiguration',
  'SmsConfiguration',
  'UserPoolTags',
  'AdminCreateUserConfig',
  'UserPoolAddOns',
  'AccountRecoverySetting',
];

const update = { UserPoolId: userPoolId };
for (const field of UPDATABLE) {
  if (pool[field] !== undefined) update[field] = pool[field];
}

update.LambdaConfig = { ...(pool.LambdaConfig ?? {}) };
if (detach) {
  delete update.LambdaConfig.PreSignUp;
} else {
  update.LambdaConfig.PreSignUp = targetArn;
}

// A temporary file rather than anything in the repository: `update-user-pool`
// takes its input as `--cli-input-json file://…`, and the payload describes the
// pool as it is right now, which is not something to leave lying around.
const payload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'play-adopt-')), 'update.json');
fs.writeFileSync(payload, JSON.stringify(update));

const carried = UPDATABLE.filter((field) => update[field] !== undefined);
console.log(`\nCarrying over ${carried.length} fields: ${carried.join(', ')}`);
console.log(`Setting PreSignUp to ${detach ? '(none)' : targetArn}\n`);

aws(['cognito-idp', 'update-user-pool', '--cli-input-json', `file://${payload}`]);
fs.rmSync(path.dirname(payload), { recursive: true, force: true });

const after = aws(['cognito-idp', 'describe-user-pool', '--user-pool-id', userPoolId]).UserPool;
const now = after.LambdaConfig?.PreSignUp;
console.log(`PreSignUp is now ${now ?? '(not set)'}`);
if (!detach && now !== targetArn) {
  console.error('The pool did not take the new trigger — check the pool for other triggers.');
  process.exit(1);
}

console.log(
  '\nDone. A first federated sign-in from now on runs the CDK-managed trigger.',
  '\nThe legacy stack can be removed — see infra/scripts/teardown-legacy-stack.sh.',
);
