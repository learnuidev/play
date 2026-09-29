#!/usr/bin/env node
/**
 * Sets the URLs Cognito is allowed to send a signed-in browser back to.
 *
 * ## What changed when the backend moved to CDK
 *
 * This was a shell script that wrote two SSM parameters and told you to deploy,
 * because the app client's OAuth settings were built from those parameters by
 * Serverless at deploy time. The CDK app **imports** the user pool and its app
 * client — an imported resource is unmanaged, so nothing it deploys can change
 * them — and that means there is no longer a deploy that applies this. There is
 * only Cognito.
 *
 * So the script now writes the app client directly, and the SSM parameters are
 * written as well because they are the record of what was intended and are what
 * a fresh `PlayAuthStack` would build a *new* pool's client from (see
 * `infra/config/play-<stage>.json`). It applies in one step, and there is
 * nothing to remember afterwards.
 *
 * ## The list
 *
 * Every place the apps are served, by default: both of them on localhost (studio
 * 3000, marketplace 3001) and both deployed — the studio on
 * studio.lets-play.xyz, the marketplace on lets-play.xyz. One list covers all
 * four because Amplify picks the entry matching the hostname the browser is on,
 * which is also why an origin that is missing cannot sign in with Google at all.
 *
 * Keep localhost in the list: it costs nothing, and dropping it means the next
 * local sign-in stops working. Keep the *bare* origin as well as the
 * `/auth/callback` path — the bare origin is where a sign-out returns to.
 *
 * ## Why it reads before it writes
 *
 * `UpdateUserPoolClient` does not patch: every attribute it is not given is set
 * back to its default. Sending only the two URL lists would quietly drop the
 * client's auth flows, its scopes and its identity providers — which is a
 * sign-in failure that looks nothing like a misconfigured redirect. So the
 * client is read first, and everything mutable is sent back with the two lists
 * changed.
 *
 * Usage:
 *   node services/api/scripts/set-auth-urls.mjs [options]
 *
 * Options:
 *   --callback-urls=<urls>  comma-separated  (default: both apps, localhost + deployed)
 *   --logout-urls=<urls>    comma-separated  (default: both apps, localhost + deployed)
 *   --stage=<name>          Backend stage    (default: dev)
 *   --profile=<name>        AWS profile      (default: scripts/api-config.env)
 *   --region=<name>         AWS region       (default: us-east-1)
 *   --google                Also let the app client use Google sign-in
 *   --no-google             Stop letting it use Google sign-in
 *   --ssm-only              Write the SSM parameters and stop, changing nothing
 *                           about the live app client
 *   --show                  Print what Cognito and SSM currently hold, change nothing
 *   --help                  Show this help
 *
 * The two Google flags exist because the identity-provider list is on the same
 * client, and `UpdateUserPoolClient` would otherwise be reached a second time by
 * `set-google-oauth.sh` through a different code path — one that does not read
 * the client back first, and would therefore reset the settings this script is
 * careful to carry over.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
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

const profile = getArg('profile', process.env.AWS_PROFILE || readApiConfig().API_AWS_PROFILE);
const region = getArg('region', process.env.AWS_REGION || 'us-east-1');
const stage = getArg('stage', process.env.STAGE || 'dev');
const show = args.includes('--show');
const ssmOnly = args.includes('--ssm-only');
const google = args.includes('--google');
const noGoogle = args.includes('--no-google');

if (google && noGoogle) {
  throw new Error('--google and --no-google contradict each other.');
}

const DEFAULT_CALLBACKS = [
  'http://localhost:3000/auth/callback',
  'http://localhost:3000',
  'http://localhost:3001/auth/callback',
  'http://localhost:3001',
  'https://studio.lets-play.xyz/auth/callback',
  'https://studio.lets-play.xyz',
  'https://lets-play.xyz/auth/callback',
  'https://lets-play.xyz',
];
const DEFAULT_LOGOUTS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://studio.lets-play.xyz',
  'https://lets-play.xyz',
];

const callbackUrls = (getArg('callback-urls') ?? DEFAULT_CALLBACKS.join(',')).split(',').filter(Boolean);
const logoutUrls = (getArg('logout-urls') ?? DEFAULT_LOGOUTS.join(',')).split(',').filter(Boolean);

function aws(argv, { optional = false } = {}) {
  try {
    return JSON.parse(
      execFileSync('aws', [...argv, '--profile', profile, '--region', region, '--output', 'json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  } catch (err) {
    if (optional) return undefined;
    throw new Error(`aws ${argv.join(' ')}\n${err.stderr ? String(err.stderr).trim() : err.message}`);
  }
}

function awsText(argv) {
  return execFileSync('aws', [...argv, '--profile', profile, '--region', region, '--output', 'text'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Which user pool, and which app client.
 *
 * From the deployed stack if there is one, and from `infra/config` otherwise.
 * The stack is the better answer — a pool recreated by phase E of
 * `docs/migration.md` would show up there and not in a committed file — but
 * being able to read the current state before the CDK stacks have ever been
 * deployed is worth the fallback, and the two cannot disagree while the pool is
 * imported.
 */
function poolIds() {
  try {
    const outputs = {};
    const stack = aws([
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      `PlayAuthStack-${stage}`,
    ]).Stacks[0];
    for (const output of stack.Outputs ?? []) outputs[output.OutputKey] = output.OutputValue;

    if (outputs.CognitoUserPoolId && outputs.CognitoUserPoolClientId) {
      return {
        poolId: outputs.CognitoUserPoolId,
        clientId: outputs.CognitoUserPoolClientId,
        source: `PlayAuthStack-${stage}`,
      };
    }
  } catch {
    // No stack yet: fall through to the committed record of what it imports.
  }

  const configFile = path.join(ROOT, 'infra', 'config', `play-${stage}.json`);
  if (!fs.existsSync(configFile)) {
    throw new Error(
      `Neither PlayAuthStack-${stage} nor ${path.relative(ROOT, configFile)} could be read.\n` +
        'Deploy the backend (npm run deploy --workspace play-infra), or discover what it\n' +
        'should import (npm run import-state --workspace play-infra).',
    );
  }

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

  // A config with no `existing` block is a stage that **creates** its pool: the
  // file exists, so the fallback above finds it, but it names no pool to write
  // to until `PlayAuthStack-<stage>` has been deployed once. Said in a sentence
  // rather than left to crash on `config.existing.userPoolId` — this is a state
  // a first save reaches on purpose (the console runs this on every save), and
  // the answer is that the auth stack builds the client with these URLs from
  // this very file.
  //
  // Printed rather than thrown, alone: the console shows this sentence in the
  // form, and a V8 stack under it would be the part a reader has to skip past to
  // reach the reason.
  if (!config.existing?.userPoolId || !config.existing?.userPoolClientId) {
    console.error(
      `${path.relative(ROOT, configFile)} imports no user pool, and PlayAuthStack-${stage} could ` +
        'not be read. A stage that creates its own pool has no app client to write to until that ' +
        'stack has been deployed once — the auth stack builds the client with these URLs from the ' +
        'config file, so a deploy applies them.',
    );
    process.exit(1);
  }

  return {
    poolId: config.existing.userPoolId,
    clientId: config.existing.userPoolClientId,
    source: path.relative(ROOT, configFile),
  };
}

const { poolId, clientId, source } = poolIds();

function currentSsm(name) {
  try {
    return awsText(['ssm', 'get-parameter', '--name', name, '--query', 'Parameter.Value']);
  } catch {
    return undefined;
  }
}

if (show) {
  const client = aws(['cognito-idp', 'describe-user-pool-client', '--user-pool-id', poolId, '--client-id', clientId])
    .UserPoolClient;

  console.log(`Pool        ${poolId}  (from ${source})`);
  console.log(`Client      ${clientId}`);
  console.log(`Provider(s) ${(client.SupportedIdentityProviders ?? []).join(', ')}`);
  console.log('\nCallback URLs Cognito accepts:');
  for (const url of client.CallbackURLs ?? []) console.log(`  ${url}`);
  console.log('\nLogout URLs Cognito accepts:');
  for (const url of client.LogoutURLs ?? []) console.log(`  ${url}`);

  console.log('\nSSM parameters (the record; applied to a new pool, not to this one):');
  for (const name of ['callback-urls', 'logout-urls']) {
    console.log(`  /play/auth/${name}  ${currentSsm(`/play/auth/${name}`) ?? '(not set)'}`);
  }
  process.exit(0);
}

console.log(`Writing SSM parameters (profile: ${profile}, region: ${region})...`);
for (const [name, values] of [
  ['callback-urls', callbackUrls],
  ['logout-urls', logoutUrls],
]) {
  awsText([
    'ssm',
    'put-parameter',
    '--name',
    `/play/auth/${name}`,
    '--type',
    'String',
    '--value',
    values.join(','),
    '--overwrite',
  ]);
}
console.log(`  /play/auth/callback-urls  ${callbackUrls.join(',')}`);
console.log(`  /play/auth/logout-urls    ${logoutUrls.join(',')}`);

if (ssmOnly) {
  console.log('\n--ssm-only: the app client was not touched.');
  process.exit(0);
}

const existing = aws([
  'cognito-idp',
  'describe-user-pool-client',
  '--user-pool-id',
  poolId,
  '--client-id',
  clientId,
]).UserPoolClient;

/**
 * Everything `UpdateUserPoolClient` accepts, read back from the client.
 *
 * A whitelist, because `DescribeUserPoolClient` also returns read-only fields —
 * `ClientId`, `UserPoolId`, `CreationDate`, `LastModifiedDate` — and sending one
 * is an error rather than something ignored.
 */
const CARRIED = [
  'ClientName',
  'RefreshTokenValidity',
  'AccessTokenValidity',
  'IdTokenValidity',
  'TokenValidityUnits',
  'ReadAttributes',
  'WriteAttributes',
  'ExplicitAuthFlows',
  'SupportedIdentityProviders',
  'DefaultRedirectURI',
  'AllowedOAuthFlows',
  'AllowedOAuthScopes',
  'AllowedOAuthFlowsUserPoolClient',
  'AnalyticsConfiguration',
  'PreventUserExistenceErrors',
  'EnableTokenRevocation',
  'EnablePropagateAdditionalUserContextData',
  'AuthSessionValidity',
];

const update = { UserPoolId: poolId, ClientId: clientId };
for (const field of CARRIED) {
  if (existing[field] !== undefined) update[field] = existing[field];
}
update.CallbackURLs = callbackUrls;
update.LogoutURLs = logoutUrls;

if (google || noGoogle) {
  // Read from the client rather than assumed, so that turning Google on does not
  // accidentally drop a provider somebody added by hand.
  const providers = new Set(existing.SupportedIdentityProviders ?? []);
  if (google) providers.add('Google');
  if (noGoogle) providers.delete('Google');
  providers.add('COGNITO');
  update.SupportedIdentityProviders = [...providers];
}

const payload = path.join(ROOT, 'node_modules', '.cache', 'set-auth-urls.json');
fs.mkdirSync(path.dirname(payload), { recursive: true });
fs.writeFileSync(payload, JSON.stringify(update));

console.log(
  `\nUpdating the app client, carrying over ${CARRIED.filter((f) => update[f] !== undefined).length} settings` +
    (google || noGoogle ? `, providers: ${update.SupportedIdentityProviders.join(', ')}` : '') +
    '...',
);
aws(['cognito-idp', 'update-user-pool-client', '--cli-input-json', `file://${payload}`]);
fs.rmSync(payload);

const after = aws([
  'cognito-idp',
  'describe-user-pool-client',
  '--user-pool-id',
  poolId,
  '--client-id',
  clientId,
]).UserPoolClient;

console.log('\nCognito now accepts:');
for (const url of after.CallbackURLs ?? []) console.log(`  callback  ${url}`);
for (const url of after.LogoutURLs ?? []) console.log(`  logout    ${url}`);

const missing = callbackUrls.filter((url) => !(after.CallbackURLs ?? []).includes(url));
if (missing.length > 0) {
  console.error(`\nNot applied: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('\nDone — no redeploy needed. Cognito is already using this list.');
