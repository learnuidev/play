#!/usr/bin/env node
/**
 * Hands the videos bucket's S3 notification over from the old stack to the CDK
 * one. **Run this once, before the first `cdk deploy`.**
 *
 * ## The problem it solves
 *
 * `put-bucket-notification-configuration` replaces a bucket's *whole*
 * notification configuration, and two rules for the same event with an
 * overlapping prefix are rejected outright:
 *
 * > Configuration is ambiguously defined. Cannot have overlapping suffixes in
 * > two rules if the prefixes are overlapping for the same event type.
 *
 * The legacy stack's rule (`s3:ObjectCreated:*` on `uploads/`, to
 * `play-backend-dev-process-video`) is already on the bucket. The CDK stack wants
 * to add its own rule for the same event, prefix and — because the bucket is
 * **imported** — it does not replace the old one. CDK's
 * `Custom::S3BucketNotifications` handler is explicitly conservative: on a create
 * it reads the bucket's existing configuration, treats *everything* it finds as
 * belonging to somebody else, and appends its own rules to it. With a bucket CDK
 * created itself the handler replaces the configuration outright; with
 * `Bucket.fromBucketName` there is no way for it to know which of the existing
 * rules are stale, so it keeps them. Two owners, one bucket, and the second
 * deploy fails.
 *
 * This is a genuine handover rather than a workaround: the bucket's notification
 * belongs to whoever processes uploads, and after the migration that is the new
 * `process-video`. The old rule has to go, and no deploy can remove it — the
 * legacy stack owns it, and the CDK stack cannot see it.
 *
 * ## What it does
 *
 * Removes the *colliding* rules and nothing else: a rule is left alone if it
 * does not overlap anything this deployment claims, so a bucket that some other
 * system also listens to keeps that system's rules — which is exactly what CDK's
 * handler would have done.
 *
 * A colliding rule that *is* ours is judged by who it belongs to. The CDK
 * handler writes every rule it creates with an id of `<stack-arn>-<hash>`, so a
 * rule's id says which stack instance made it:
 *
 * - **the stack this deployment is about to become** — the rule is left alone.
 *   The live stack owns it, and either it is the one CDK will re-assert on the
 *   coming deploy, or it is a duplicate of it, and removing a working rule
 *   before a deploy that might not happen is a worse outcome than a duplicate
 *   that the deploy itself resolves.
 * - **any other stack instance** — it is a leftover, and it is removed. This is
 *   the case that costs somebody an afternoon: a bucket's notification rule
 *   outlives the stack that created it whenever that stack was rolled back and
 *   deleted, and a *fresh* stack's first deploy then fails, because CDK's
 *   handler treats a rule it did not make in this invocation as somebody else's
 *   and adds its own beside it — and S3 refuses two rules for one event and an
 *   overlapping prefix: "Configuration is ambiguously defined". The message
 *   names neither the bucket nor the rule, and the retry only works if something
 *   removes the leftover first. This is that something.
 *
 * It is idempotent: run it twice and the second run finds nothing to do. Once
 * the CDK stack has deployed and the legacy stack is gone, there is nothing left
 * for it to remove, and it will say so.
 *
 * ## Between running it and deploying
 *
 * Uploads are not processed in that window. It is seconds to minutes, and it is
 * the only moment in the migration where anything is not being handled — the
 * exception being if the deploy then fails, in which case uploads stay
 * unprocessed until it is retried. Which is why it is a step you run on purpose
 * rather than something a deploy does behind your back: `cdk diff` should be the
 * only thing that runs before a deploy.
 *
 * Usage:
 *   node infra/scripts/handover-s3-notifications.mjs [options]
 *
 * Options:
 *   --stage=<name>    Backend stage  (default: dev)
 *   --profile=<name>  AWS profile    (default: scripts/api-config.env)
 *   --region=<name>   AWS region     (default: us-east-1)
 *   --plan            Print what would be removed, change nothing
 *   --yes             Skip the confirmation
 *   --help            Show this help
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INFRA = path.resolve(HERE, '..');
const ROOT = path.resolve(INFRA, '..');
const args = process.argv.slice(2);

/**
 * What this deployment claims: one event, one prefix.
 *
 * From `src/generated/service.ts` — `process-video` is notified from
 * `s3:ObjectCreated:*` under `uploads/`, and it is the only S3 notification the
 * service has. If a second one is ever added, this is the list that has to learn
 * about it, and the collision it would otherwise create is the same one.
 */
const CLAIMED = [{ events: ['s3:ObjectCreated:*'], prefix: 'uploads/' }];

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
const plan = args.includes('--plan');
const assumeYes = args.includes('--yes');

const configFile = path.join(INFRA, 'config', `play-${stage}.json`);
if (!fs.existsSync(configFile)) {
  console.error(
    `No ${path.relative(ROOT, configFile)}. Discover the deployed resources first:\n\n` +
      '  npm run import-state --workspace play-infra\n',
  );
  process.exit(1);
}

const bucket = JSON.parse(fs.readFileSync(configFile, 'utf8')).existing.videosBucket;

function aws(argv, { parse = true } = {}) {
  const out = execFileSync('aws', [...argv, '--profile', profile, '--region', region, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!parse) return out;

  // An empty body is a real answer here rather than a failure. S3 returns
  // nothing at all for a bucket with no notification configuration, and the CLI
  // passes that through as zero bytes — so the read-back after removing the last
  // rule is the one call in this script that has to cope with `''`.
  if (out.trim() === '') return {};

  return JSON.parse(out);
}

/** The function a rule invokes, from its ARN — `play-dev-process-video`. */
const functionNameOf = (rule) => (rule.LambdaFunctionArn ?? '').split(':function:')[1]?.split(':')[0] ?? '';

/** Whether a rule targets a function of this deployment rather than the old one's. */
const isOurs = (rule) => functionNameOf(rule).startsWith(`play-${stage}-`);

/** The stack this script is clearing the way for. */
const API_STACK_NAME = `PlayApiStack-${stage}`;

/**
 * The ARN of that stack, or `undefined` when it does not exist yet.
 *
 * Read rather than assumed: the ARN carries a UUID that changes every time a
 * stack is deleted and created again, and that UUID is the only thing that can
 * tell a rule belonging to the stack about to be deployed from a rule belonging
 * to the stack instance that failed to deploy an hour ago.
 */
function currentStackArn() {
  try {
    const out = execFileSync(
      'aws',
      [
        'cloudformation',
        'describe-stacks',
        '--stack-name',
        API_STACK_NAME,
        '--query',
        'Stacks[0].StackId',
        '--output',
        'text',
        '--profile',
        profile,
        '--region',
        region,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    return out && out !== 'None' ? out : undefined;
  } catch {
    // A stack that is not there is not an error: that is the first deploy, which
    // is exactly when every leftover rule has to go.
    return undefined;
  }
}

/**
 * Whether a rule belongs to the stack this deployment is about to become.
 *
 * CDK's notifications handler ids every rule it creates as `<stack-arn>-<hash>`,
 * so a rule that does not carry this stack's ARN was made by some other stack
 * instance — one that has since been deleted, or one whose rollback could not
 * clear its rule. Either way it is a leftover, and on a fresh deploy it is the
 * thing that makes the create fail.
 */
function belongsToLiveStack(rule, stackArn) {
  if (!stackArn) return false;
  return String(rule.Id ?? '').startsWith(`${stackArn}-`);
}

/** `uploads/`, or undefined for a rule with no prefix filter. */
const prefixOf = (rule) =>
  rule.Filter?.Key?.FilterRules?.find((r) => r.Name.toLowerCase() === 'prefix')?.Value;

/**
 * Whether two prefixes can match the same key.
 *
 * `uploads/` and `uploads/raw/` overlap: a key under the second is also under
 * the first. Neither containing the other means they are disjoint, and two
 * disjoint prefixes are exactly what S3 allows for one event type.
 */
function prefixesOverlap(a, b) {
  if (a === undefined || b === undefined) return true; // an absent prefix matches everything
  return a.startsWith(b) || b.startsWith(a);
}

function collides(rule) {
  const events = rule.Events ?? [];
  const prefix = prefixOf(rule);
  return CLAIMED.some(
    (claim) =>
      claim.events.some((event) => events.includes(event)) &&
      prefixesOverlap(claim.prefix, prefix),
  );
}

console.log(`Bucket:  ${bucket}`);
console.log(`Stage:   ${stage} (profile: ${profile}, region: ${region})`);

const current = aws(['s3api', 'get-bucket-notification-configuration', '--bucket', bucket]);
const existing = current.LambdaFunctionConfigurations ?? [];

if (existing.length === 0) {
  console.log('\nThe bucket has no notification configuration — nothing to hand over.');
  process.exit(0);
}

// Read before the report, so it can say which of our own rules are leftovers.
const stackArn = currentStackArn();

console.log('\nOn the bucket now:');
for (const rule of existing) {
  const prefix = prefixOf(rule);
  const owner = !isOurs(rule)
    ? 'legacy'
    : belongsToLiveStack(rule, stackArn)
      ? 'ours  '
      : 'stale ';
  console.log(
    `  ${owner}  ${functionNameOf(rule)}` +
      `  [${(rule.Events ?? []).join(', ')}${prefix ? ` on ${prefix}` : ''}]`,
  );
}

const keep = existing.filter(
  (rule) => !collides(rule) || (isOurs(rule) && belongsToLiveStack(rule, stackArn)),
);
const remove = existing.filter((rule) => !keep.includes(rule));

if (remove.length === 0) {
  console.log('\nNothing overlaps what this deployment claims — nothing to do.');
  console.log('(The handover has already happened, or the new stack already owns this.)');
  process.exit(0);
}

console.log('\nWould be removed:');
for (const rule of remove) {
  const prefix = prefixOf(rule);
  console.log(`  ${functionNameOf(rule)}  [${(rule.Events ?? []).join(', ')}${prefix ? ` on ${prefix}` : ''}]`);
}
console.log('\nWould be kept:');
if (keep.length === 0) console.log('  (nothing)');
for (const rule of keep) console.log(`  ${functionNameOf(rule)}`);

if (plan) {
  console.log('\n--plan: nothing was changed.');
  process.exit(0);
}

if (!assumeYes) {
  console.log(
    [
      '',
      'Until the API stack is deployed, uploads to this bucket are not processed.',
      'That window is the point of this step, not a side effect of it.',
      '',
      'Deploy immediately afterwards:',
      '',
      '  npm run deploy:api --workspace play-infra',
      '',
      'Type "hand over" to continue:',
    ].join('\n'),
  );
  const answer = fs.readFileSync(0, 'utf8').trim();
  if (answer !== 'hand over') {
    console.log(`Aborted — '${answer}' is not 'hand over'.`);
    process.exit(1);
  }
}

const payload = {
  ...(keep.length > 0 ? { LambdaFunctionConfigurations: keep } : {}),
  ...(current.TopicConfigurations ? { TopicConfigurations: current.TopicConfigurations } : {}),
  ...(current.QueueConfigurations ? { QueueConfigurations: current.QueueConfigurations } : {}),
  ...(current.EventBridgeConfiguration ? { EventBridgeConfiguration: current.EventBridgeConfiguration } : {}),
};

const file = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'play-handover-')), 'config.json');
fs.writeFileSync(file, JSON.stringify(payload));

console.log(`\nRemoving ${remove.length} rule(s)...`);
aws(['s3api', 'put-bucket-notification-configuration', '--bucket', bucket, '--notification-configuration', `file://${file}`], {
  parse: false,
});
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const after = aws(['s3api', 'get-bucket-notification-configuration', '--bucket', bucket]);
const left = after.LambdaFunctionConfigurations ?? [];
console.log(`\nDone. The bucket now has ${left.length} rule(s):`);
if (left.length === 0) console.log('  (none — the CDK stack is about to add its own)');
for (const rule of left) console.log(`  ${functionNameOf(rule)}`);

console.log(
  [
    '',
    'Deploy now, so the bucket is not left without a rule:',
    '',
    '  npm run deploy:api --workspace play-infra',
    '',
    'That deploy adds `play-' + stage + '-process-video` for the same event and prefix,',
    'and from then on the configuration has one owner and CDK keeps it in step.',
  ].join('\n'),
);
