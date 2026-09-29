#!/usr/bin/env node
/**
 * Marks the legacy stack's stateful resources `Retain`, so the stack can be
 * deleted without taking the product with it.
 *
 * ## Why this is needed, and why the obvious approach does not work
 *
 * `play-backend-<stage>` still owns every table, the videos bucket, the
 * CloudFront distribution and the Cognito user pool. The CDK app imports all of
 * them. A plain `delete-stack` would delete them, which is 23 tables of courses,
 * lessons, memberships and credentials, and every account in the pool.
 *
 * The obvious fix is `aws cloudformation delete-stack --retain-resources …`, and
 * it does not work:
 *
 * > When you delete a stack, specify which resources to retain only when the
 * > stack is in the DELETE_FAILED state.
 *
 * `--retain-resources` is the recovery path for a stack whose *deletion already
 * failed* — you retry and skip whatever was blocking it. It is not a way to say
 * "keep these". Against a healthy stack CloudFormation rejects the call outright,
 * before deleting anything, which is how this was found out.
 *
 * The mechanism that does work is `DeletionPolicy: Retain`, which is a
 * *template* attribute: CloudFormation leaves the resource in place when the
 * stack goes and simply stops managing it. So this script takes the stack's own
 * template, adds the attribute to the resources that hold state, and updates the
 * stack with it. Nothing about the resources changes — a deletion policy is not
 * a property, so the update is a no-op for every one of them.
 *
 * This is the step the original plan for this migration called "phase A", and it
 * was right: the insurance has to be in place *before* anything is deleted.
 *
 * ## Running it
 *
 * ```
 * node infra/scripts/retain-legacy-resources.mjs --plan   # what would be marked
 * node infra/scripts/retain-legacy-resources.mjs          # apply, via a change set
 * ```
 *
 * It is idempotent: run it again and it reports that everything is already
 * marked. Run it again *after* the stack is gone and it says there is no such
 * stack.
 *
 * Usage:
 *   node infra/scripts/retain-legacy-resources.mjs [options]
 *
 * Options:
 *   --stage=<name>       Backend stage    (default: dev)
 *   --profile=<name>     AWS profile      (default: scripts/api-config.env)
 *   --region=<name>      AWS region       (default: us-east-1)
 *   --legacy-stack=<n>   Stack to harden  (default: play-backend-<stage>)
 *   --plan               Print what would change, change nothing
 *   --check              Exit non-zero if anything is still unmarked, and say
 *                        nothing else. This is what the teardown script calls
 *                        before it is willing to delete anything
 *   --yes                Skip the confirmation
 *   --help               Show this help
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);

/**
 * The resource types that hold state this deployment cannot recreate.
 *
 * By *type*, not by name, and that is the whole safety argument: the names are
 * exactly the thing a regenerated table changes, and a name missing from a
 * hardcoded list would be a table deleted by a script whose entire job is not to
 * delete tables.
 *
 *   DynamoDB tables          every course, lesson, membership, comment, credential
 *   S3 buckets               every uploaded and processed video, and the CDN logs
 *   S3 bucket policy         CloudFront's permission to read the videos —
 *                            declared in PlayMediaStack, and lost with the stack
 *   CloudFront pieces        the distribution, key group and public key: a new
 *                            distribution is a new domain in every player
 *   Cognito pieces           every account, including the federated ones
 *   Custom::S3               the bucket's notification configuration, which
 *                            PlayApiStack set. Letting CloudFormation delete it
 *                            wipes that configuration, after which uploads stop
 *                            being processed — silently, because nothing errors
 */
const RETAIN_TYPES = [
  'AWS::DynamoDB::Table',
  'AWS::S3::Bucket',
  'AWS::S3::BucketPolicy',
  'AWS::CloudFront::Distribution',
  'AWS::CloudFront::KeyGroup',
  'AWS::CloudFront::PublicKey',
  'AWS::CloudFront::OriginAccessControl',
  'AWS::Cognito::UserPool',
  'AWS::Cognito::UserPoolClient',
  'AWS::Cognito::UserPoolDomain',
  'AWS::Cognito::UserPoolIdentityProvider',
  'Custom::S3',
];

/**
 * The exceptions, and the only resources here whose deletion is wanted:
 * Serverless's own deployment bucket, which holds the zipped handlers of a stack
 * being removed. No product data, and keeping it would leave a bucket of dead
 * artifacts nothing will ever empty.
 */
const EXCLUDED = ['ServerlessDeploymentBucket', 'ServerlessDeploymentBucketPolicy'];

// --- arguments ---------------------------------------------------------------

function usage() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
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
const stackName = getArg('legacy-stack', `play-backend-${stage}`);
const plan = args.includes('--plan');
const check = args.includes('--check');
const assumeYes = args.includes('--yes');

function aws(argv, { parse = true } = {}) {
  const out = execFileSync('aws', [...argv, '--profile', profile, '--region', region], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!parse) return out;
  if (out.trim() === '') return {};
  return JSON.parse(out);
}

console.log(`Legacy stack: ${stackName} (profile: ${profile}, region: ${region})`);

let status;
try {
  status = aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    stackName,
    '--query',
    'Stacks[0].StackStatus',
    '--output',
    'json',
  ]);
} catch (err) {
  // Only "there is no such stack" is a normal answer. Anything else — an expired
  // token, a wrong region — is a failure, and reporting it as "already removed"
  // would be a lie that reads like success.
  if (/does not exist|ValidationError/.test(String(err.message))) {
    console.log('\nNo such stack — it has already been removed. Nothing to do.');
    process.exit(0);
  }
  throw err;
}
console.log(`Status:       ${status}`);

// --- read the template --------------------------------------------------------

const template = aws(['cloudformation', 'get-template', '--stack-name', stackName, '--output', 'json'])
  .TemplateBody;

const resources = template.Resources ?? {};

const targets = Object.entries(resources).filter(
  ([id, resource]) => RETAIN_TYPES.includes(resource.Type) && !EXCLUDED.includes(id),
);

if (targets.length === 0) {
  console.error(
    `\nRefusing: none of the ${Object.keys(resources).length} resources in ${stackName} ` +
      'match the types this script retains. Check that this is the legacy Serverless stack.',
  );
  process.exit(1);
}

const needPolicy = targets.filter(
  ([, resource]) => resource.DeletionPolicy !== 'Retain' || resource.UpdateReplacePolicy !== 'Retain',
);

// The teardown script's precondition, and the reason this mode exists rather
// than that script doing its own check: the list of resource types that hold
// state lives here, in one place, and a second copy of it in a shell script is a
// second copy that can drift.
if (check) {
  if (needPolicy.length === 0) {
    console.log(`${stackName}: all ${targets.length} stateful resources are marked Retain.`);
    process.exit(0);
  }
  console.error(
    `${stackName}: ${needPolicy.length} of ${targets.length} stateful resources are NOT marked Retain:`,
  );
  for (const [id] of needPolicy) console.error(`  ${id}`);
  process.exit(1);
}

console.log(`\n${Object.keys(resources).length} resources, ${targets.length} stateful:`);

if (needPolicy.length === 0) {
  console.log('  every one already has DeletionPolicy: Retain — nothing to do.');
  console.log('\nThe stack is safe to delete: infra/scripts/teardown-legacy-stack.sh');
  process.exit(0);
}

for (const [id, resource] of targets) {
  const marked = resource.DeletionPolicy === 'Retain' && resource.UpdateReplacePolicy === 'Retain';
  console.log(`  ${marked ? 'retain' : 'ADD   '}  ${id}  (${resource.Type})`);
}

if (plan) {
  console.log(`\n${needPolicy.length} would be marked Retain. --plan: nothing was changed.`);
  process.exit(0);
}

// One confirmation, and it is deliberately after the change set rather than
// before it: that is the point at which there is something to look at. Asking
// twice asks the second question to somebody who has already answered once.
for (const [, resource] of needPolicy) {
  resource.DeletionPolicy = 'Retain';
  resource.UpdateReplacePolicy = 'Retain';
}

// --- apply through a change set ----------------------------------------------
//
// The template goes through S3 rather than `--template-body`, and it has to: at
// 543 KB this one is ten times over the 51,200-byte inline limit. That limit is
// not reported as a size problem — the CLI answers with
// `HTTP content length exceeded 251904 bytes` wrapped in an XML parse error,
// which reads as a broken installation rather than as a template that is too
// big. It is why Serverless uploaded this template too, and why the deployment
// bucket it left behind is the natural place to put ours: it is part of the
// stack being hardened and goes away with it.
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'play-retain-')), 'template.json');
fs.writeFileSync(file, JSON.stringify(template));

let bucket;
try {
  bucket = aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    stackName,
    '--query',
    "Stacks[0].Outputs[?OutputKey=='ServerlessDeploymentBucketName'].OutputValue",
    '--output',
    'json',
  ]);
} catch {
  bucket = undefined;
}

if (!bucket) {
  console.error(
    `\nRefusing: ${stackName} has no ServerlessDeploymentBucketName output, and there is\n` +
      'nowhere to stage a template this size. Pass --bucket=<name> to name one.',
  );
  process.exit(1);
}

const key = `retain-hardening/template-${Date.now()}.json`;

console.log(`\nUploading the hardened template to s3://${bucket}/${key}...`);
aws(['s3', 'cp', file, `s3://${bucket}/${key}`], { parse: false });

const changeSetName = `retain-stateful-${Date.now()}`;

console.log('Creating a change set...');
aws([
  'cloudformation',
  'create-change-set',
  '--stack-name',
  stackName,
  '--change-set-name',
  changeSetName,
  '--template-url',
  `https://s3.${region}.amazonaws.com/${bucket}/${key}`,
  '--capabilities',
  'CAPABILITY_IAM',
  'CAPABILITY_NAMED_IAM',
  '--description',
  'Mark the resources that hold state Retain, so the stack can be deleted safely',
  '--output',
  'json',
]);
fs.rmSync(path.dirname(file), { recursive: true, force: true });

// Wait for CloudFormation to finish computing the diff. On a stack this size
// that is not instant.
process.stdout.write('Waiting for the change set');
let changeSetStatus = 'CREATE_IN_PROGRESS';
for (let attempt = 0; attempt < 120 && changeSetStatus === 'CREATE_IN_PROGRESS'; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  process.stdout.write('.');
  changeSetStatus = aws([
    'cloudformation',
    'describe-change-set',
    '--stack-name',
    stackName,
    '--change-set-name',
    changeSetName,
    '--query',
    'Status',
    '--output',
    'json',
  ]);
}
console.log(` ${changeSetStatus}`);

if (changeSetStatus !== 'CREATE_COMPLETE') {
  const reason = aws([
    'cloudformation',
    'describe-change-set',
    '--stack-name',
    stackName,
    '--change-set-name',
    changeSetName,
    '--query',
    'StatusReason',
    '--output',
    'json',
  ]);
  console.error(`\nThe change set did not succeed: ${reason}`);
  process.exit(1);
}

// What it would do, read back from CloudFormation rather than assumed.
//
// The marked resources do **not** appear here, and that is the reassuring part:
// a deletion policy is not a resource property, so CloudFormation does not see
// one as a change to the resource. What does appear is one entry per nested
// stack, because re-submitting a template that contains them always re-evaluates
// them — worth reading, and worth checking that none of them says `Replace`.
const changes =
  aws([
    'cloudformation',
    'describe-change-set',
    '--stack-name',
    stackName,
    '--change-set-name',
    changeSetName,
    '--query',
    'Changes[].ResourceChange.[Action,LogicalResourceId,ResourceType,Replacement]',
    '--output',
    'json',
  ]) ?? [];

const replaces = changes.filter((change) => change[3] === 'True');
const conditional = changes.filter((change) => change[3] === 'Conditional');
console.log(
  `\n${changes.length} resource change(s): ` +
    `${replaces.length} would replace, ${conditional.length} conditional, ` +
    `${changes.length - replaces.length - conditional.length} in place`,
);

// A deletion policy is not a property, so the resources this script marked do
// not appear in here at all. What does appear is:
//
//   - one entry per nested stack, which CloudFormation always re-evaluates when
//     a template containing them is re-submitted;
//   - one per `AWS::Lambda::Permission`, flagged `Conditional` because the
//     permission's `FunctionName` is an `Fn::GetAtt` of a function whose ARN
//     CloudFormation cannot resolve while computing the change set. It is
//     "conditional" on that attribute changing — and the function is not in this
//     update, so it does not change, so nothing is replaced.
//
// Which is why the check below is on `True` rather than on anything that is not
// `False`. A `Conditional` that is really going to happen would mean some other
// resource in this update is changing, and that would be visible on its own.
if (replaces.length > 0) {
  console.error('\nRefusing: this update would replace resources.');
  for (const change of replaces.slice(0, 20)) console.error(`  ${change.join('  ')}`);
  console.error(
    `\nThat is not what marking a deletion policy should do. The change set is still\n` +
      `there under ${changeSetName} — read it before going further.\n`,
  );
  process.exit(1);
}

if (conditional.length > 0) {
  console.log(
    `  (the ${conditional.length} conditional ones reference another resource's\n` +
      '   attribute; nothing in this update changes any of those, so they do not\n' +
      '   replace — they are the nested stacks and the gateway Lambda permissions)',
  );
}

if (!assumeYes) {
  console.log(
    '\nNothing is modified and nothing is replaced: a deletion policy is a template\n' +
      'attribute, so CloudFormation leaves every resource exactly as it is and only\n' +
      'records that these should survive the stack.\n\n' +
      'Type "retain" to continue:',
  );
  const answer = fs.readFileSync(0, 'utf8').trim();
  if (answer !== 'retain') {
    console.log(`Aborted — '${answer}' is not 'retain'.`);
    process.exit(1);
  }
}

console.log('\nExecuting...');
aws(
  ['cloudformation', 'execute-change-set', '--stack-name', stackName, '--change-set-name', changeSetName],
  { parse: false },
);
aws(['cloudformation', 'wait', 'stack-update-complete', '--stack-name', stackName], { parse: false });

// The staged template goes with the stack. Removing it now keeps the deployment
// bucket holding only what it held before.
try {
  aws(['s3', 'rm', `s3://${bucket}/${key}`], { parse: false });
} catch {
  console.log(`(could not remove s3://${bucket}/${key} — harmless, it goes with the stack)`);
}

// --- verify against the live template, not the one we sent --------------------

const after = aws(['cloudformation', 'get-template', '--stack-name', stackName, '--output', 'json'])
  .TemplateBody.Resources ?? {};

const unmarked = targets.filter(
  ([id]) => after[id]?.DeletionPolicy !== 'Retain' || after[id]?.UpdateReplacePolicy !== 'Retain',
);

console.log(`\n${targets.length - unmarked.length} of ${targets.length} stateful resources now Retain.`);

if (unmarked.length > 0) {
  console.error('Still unmarked:');
  for (const [id] of unmarked) console.error(`  ${id}`);
  process.exit(1);
}

console.log(
  `\n${stackName} can now be deleted: the resources above will be left in place, unmanaged.\n\n` +
    '  infra/scripts/teardown-legacy-stack.sh\n',
);
