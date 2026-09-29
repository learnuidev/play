#!/usr/bin/env node
/**
 * Reads the *existing* Play backend out of AWS and writes `infra/config/play-<stage>.json`.
 *
 * The CDK app does not create the tables, the videos bucket, the CloudFront
 * distribution or the Cognito user pool — those are imported, so it has to be
 * told what they are called. It could look them up at synth time (an SSM
 * lookup, a `valueFromLookup`), and it deliberately does not: a synth that
 * reaches AWS is a synth that needs credentials and a network, and a lookup that
 * silently misses bakes the *parameter name* into a Lambda's environment instead
 * of failing. So the names are read once, committed, and reviewed.
 *
 * Run it with `npm run import-state --workspace play-infra`. It is read-only:
 * every call below is a `describe`, a `list` or a `get`.
 *
 * It is safe to re-run. Values are merged into whatever is already in the file,
 * so a hand edit to a field the script does not discover — or to the ownership
 * switches — survives.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(
    [
      'Usage: node scripts/import-state.mjs [options]',
      '',
      'Options:',
      '  --stage=<name>       Backend stage               (default: dev)',
      '  --profile=<name>     AWS profile                 (default: scripts/api-config.env)',
      '  --region=<name>      AWS region                  (default: us-east-1)',
      '  --stack-name=<name>  Legacy CloudFormation stack (default: play-backend-<stage>)',
      '  --out=<path>         Output file                 (default: infra/config/play-<stage>.json)',
      '  --help               Show this help',
    ].join('\n'),
  );
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
const region = getArg('region', process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1');
const profile = getArg('profile', process.env.AWS_PROFILE || readApiConfig().API_AWS_PROFILE);
const stackName = getArg('stack-name', `play-backend-${stage}`);
const outFile = path.resolve(
  ROOT,
  getArg('out', path.join('infra', 'config', `play-${stage}.json`)),
);

/** One `aws` call. Failures are the caller's to interpret. */
function aws(argv, { optional = false } = {}) {
  try {
    const raw = execFileSync(
      'aws',
      [...argv, '--profile', profile, '--region', region, '--output', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(raw);
  } catch (err) {
    if (optional) return undefined;
    const stderr = err.stderr ? String(err.stderr).trim() : err.message;
    throw new Error(`aws ${argv.join(' ')}\n${stderr}`);
  }
}

console.log(`Reading '${stackName}' (profile: ${profile}, region: ${region})...`);

const account = aws(['sts', 'get-caller-identity']).Account;
const stack = aws(['cloudformation', 'describe-stacks', '--stack-name', stackName]).Stacks[0];

const outputs = {};
for (const output of stack.Outputs ?? []) outputs[output.OutputKey] = output.OutputValue;

// `list-stack-resources` rather than `describe-stack-resources`, which silently
// truncates at 100 resources on this stack and returns no NextToken — the tables
// never appear in it. This one paginates.
const summaries = [];
let nextToken;
do {
  const page = aws([
    'cloudformation',
    'list-stack-resources',
    '--stack-name',
    stackName,
    ...(nextToken ? ['--next-token', nextToken] : []),
  ]);
  summaries.push(...(page.StackResourceSummaries ?? []));
  nextToken = page.NextToken;
} while (nextToken);

console.log(`  ${summaries.length} resources in the stack`);

const physical = (logicalId, type) => {
  const found = summaries.find(
    (s) => s.LogicalResourceId === logicalId && (!type || s.ResourceType === type),
  );
  return found && found.PhysicalResourceId;
};

const tables = {};
for (const summary of summaries) {
  if (summary.ResourceType === 'AWS::DynamoDB::Table') {
    tables[summary.LogicalResourceId] = summary.PhysicalResourceId;
  }
}

// The user pool's app client is the one thing here whose settings this app has
// to know and cannot change: an imported pool is unmanaged, so the callback
// URLs are read for the record — `services/api/scripts/set-auth-urls.sh` is
// what writes them, and it now writes them to Cognito directly.
const userPoolId = outputs.CognitoUserPoolId ?? physical('CognitoUserPool');
const userPoolClientId = outputs.CognitoUserPoolClientId ?? physical('CognitoUserPoolClient');
const client = aws(
  ['cognito-idp', 'describe-user-pool-client', '--user-pool-id', userPoolId, '--client-id', userPoolClientId],
  { optional: true },
)?.UserPoolClient;

// Deploy-time settings that used to be interpolated out of SSM by Serverless
// (`${ssm:/play/mail/from-address}`) and are now plain config. The parameters
// are still read, because they are where the scripts write.
const parameter = (name) =>
  aws(['ssm', 'get-parameter', '--name', name], { optional: true })?.Parameter?.Value;

const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};

const config = {
  stage,
  account,
  region,

  // --- what this deployment stands on ---------------------------------------
  existing: {
    tables: { ...(previous.existing?.tables ?? {}), ...tables },
    videosBucket:
      outputs.VideosBucketName ?? physical('VideosBucket') ?? previous.existing?.videosBucket,
    cloudFrontLogsBucket:
      physical('CloudFrontLogsBucket') ?? previous.existing?.cloudFrontLogsBucket,
    cloudFrontDistributionId:
      physical('VideoDistribution') ?? previous.existing?.cloudFrontDistributionId,
    cloudFrontDomain:
      outputs.CloudFrontDomain ?? previous.existing?.cloudFrontDomain,
    cloudFrontPublicKeyId:
      physical('VideoPublicKey') ?? previous.existing?.cloudFrontPublicKeyId,
    userPoolId,
    userPoolClientId,
    userPoolDomain: physical('CognitoUserPoolDomain') ?? previous.existing?.userPoolDomain,
    googleSignInEnabled:
      (outputs.GoogleAuthEnabled ?? String(!!physical('GoogleIdentityProvider'))) === 'true',
  },

  // --- deploy-time settings --------------------------------------------------
  //
  // These were `${ssm:...}` interpolations in the YAML. They are plain config
  // now, because a synth-time SSM lookup needs credentials and a network and
  // fails by writing a parameter's *name* into a Lambda's environment. The
  // parameters themselves are still where `services/api/scripts/*.sh` write, and
  // those scripts keep this file in step.
  mail: {
    fromAddress:
      parameter('/play/mail/from-address') ??
      previous.mail?.fromAddress ??
      'learnuidev@gmail.com',
    appBaseUrl:
      parameter('/play/mail/app-base-url') ??
      previous.mail?.appBaseUrl ??
      'http://localhost:3000',
    marketplaceBaseUrl:
      parameter('/play/mail/marketplace-base-url') ??
      previous.mail?.marketplaceBaseUrl ??
      'http://localhost:3001',
  },

  auth: {
    googleClientId:
      parameter('/play/auth/google-client-id') ??
      previous.auth?.googleClientId ??
      '',
    callbackUrls:
      client?.CallbackURLs ??
      previous.auth?.callbackUrls ?? [
        'http://localhost:3000/auth/callback',
        'http://localhost:3000',
        'http://localhost:3001/auth/callback',
        'http://localhost:3001',
      ],
    logoutUrls:
      client?.LogoutURLs ?? previous.auth?.logoutUrls ?? ['http://localhost:3000', 'http://localhost:3001'],
  },

  cloudFrontPrivateKeyParam:
    previous.cloudFrontPrivateKeyParam ?? '/play/cloudfront/private-key',

  /**
   * Ownership. **All three are false in a migrated repository, and false is
   * what you want**: an imported resource is unmanaged, so CDK will not change
   * its properties and will not delete it. Flipping one on means "create this
   * instead of importing it", which for the tables means copying the data first
   * and for the user pool means every account re-registering. Read
   * docs/migration.md phase E before touching them.
   */
  ownership:
    previous.ownership ?? { tables: false, media: false, auth: false },
};

// A table with no name is a deploy that fails at the first Lambda, so say so now
// rather than at the first request.
const named = Object.values(config.existing.tables).filter(Boolean).length;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Wrote ${path.relative(ROOT, outFile)}`);
console.log(`  ${named} tables, bucket ${config.existing.videosBucket}`);
console.log(`  distribution ${config.existing.cloudFrontDistributionId}, pool ${userPoolId}`);
