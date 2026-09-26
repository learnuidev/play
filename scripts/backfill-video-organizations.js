#!/usr/bin/env node
'use strict';

/**
 * Assigns videos that predate organizations to an organization.
 *
 * Videos uploaded before organizations existed have no `organizationId`, so
 * they belong to nobody but their uploader. Once assigned, they appear in the
 * organization's library and every member of the organization can see them.
 *
 * The uploader keeps access either way (see `src/lib/access.ts`), so this
 * cannot lock anyone out of their own uploads — but an owner who is *not* a
 * member of the organization will not see the rest of its library, which the
 * script reports.
 *
 * Usage:
 *   node scripts/backfill-video-organizations.js --organization-id=<orgId>
 *   node scripts/backfill-video-organizations.js --organization-id=<orgId> --dry-run
 *
 * Options:
 *   --organization-id=<id>       (required) organization to assign videos to
 *   --dry-run                    report what would change, write nothing
 *   --profile=<aws-profile>      default: yoserverless
 *   --region=<aws-region>        default: us-east-1
 *   --stack=<stack-name>         default: play-backend-dev
 *   --videos-table=<name>        override table name resolution
 *   --organizations-table=<name> override table name resolution
 *   --members-table=<name>       override table name resolution
 *
 * Table names carry a CloudFormation suffix, so they are resolved from the
 * deployed stack via the AWS CLI unless overridden. Safe to re-run: videos that
 * already have an organization are skipped, and the update refuses to overwrite
 * an organization assigned after the scan.
 */

const { execFileSync } = require('node:child_process');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const DEFAULTS = {
  profile: 'yoserverless',
  region: 'us-east-1',
  stack: 'play-backend-dev',
};

function usage(message, exitCode = 1) {
  const text = `Usage: node scripts/backfill-video-organizations.js --organization-id=<orgId> [options]

Options:
  --organization-id=<id>        (required) organization to assign videos to
  --dry-run                     report what would change, write nothing
  --profile=<aws-profile>       default: ${DEFAULTS.profile}
  --region=<aws-region>         default: ${DEFAULTS.region}
  --stack=<stack-name>          default: ${DEFAULTS.stack}
  --videos-table=<name>         override table name resolution
  --organizations-table=<name>  override table name resolution
  --members-table=<name>        override table name resolution`;

  // Help requested on purpose goes to stdout; a usage error goes to stderr.
  if (message) {
    console.error(`\nError: ${message}\n`);
    console.error(text);
  } else {
    console.log(text);
  }
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--organization-id=')) args.organizationId = arg.slice('--organization-id='.length);
    else if (arg.startsWith('--profile=')) args.profile = arg.slice('--profile='.length);
    else if (arg.startsWith('--region=')) args.region = arg.slice('--region='.length);
    else if (arg.startsWith('--stack=')) args.stack = arg.slice('--stack='.length);
    else if (arg.startsWith('--videos-table=')) args.videosTable = arg.slice('--videos-table='.length);
    else if (arg.startsWith('--organizations-table=')) args.organizationsTable = arg.slice('--organizations-table='.length);
    else if (arg.startsWith('--members-table=')) args.membersTable = arg.slice('--members-table='.length);
    else usage(`Unknown option: ${arg}`);
  }
  return args;
}

/** Runs a command, turning CLI failures into readable errors. */
function run(cmd, argv) {
  try {
    return execFileSync(cmd, argv, { encoding: 'utf8' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `Could not find the '${cmd}' executable. Install the AWS CLI ` +
          '(https://aws.amazon.com/cli/) and make sure it is on your PATH.',
      );
    }
    const stderr = err.stderr ? String(err.stderr).trim() : err.message;
    throw new Error(`Command failed: ${cmd} ${argv.join(' ')}\n${stderr}`);
  }
}

/** Resolves a table's physical name from the deployed stack's outputs. */
function resolveTableName(outputKey, { stack, profile, region }) {
  const raw = run('aws', [
    'cloudformation',
    'describe-stacks',
    '--stack-name', stack,
    '--profile', profile,
    '--region', region,
    '--output', 'json',
  ]);

  const parsed = JSON.parse(raw);
  const found = (parsed.Stacks?.[0]?.Outputs ?? []).find((o) => o.OutputKey === outputKey);
  if (!found || !found.OutputValue) {
    throw new Error(
      `Stack '${stack}' has no '${outputKey}' output. Redeploy the backend so it exports ` +
        'table names (npm run deploy -- --aws-profile ' + profile + '), or pass the table ' +
        'name explicitly (--videos-table=, --organizations-table=, --members-table=).',
    );
  }
  return found.OutputValue;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) usage(undefined, 0);
  if (!args.organizationId) usage('--organization-id is required');

  // The default credential chain reads AWS_PROFILE, so setting it here is what
  // makes --profile work without threading explicit credentials through.
  process.env.AWS_PROFILE = args.profile;

  const doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: args.region }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  const videosTable = args.videosTable || resolveTableName('VideosTableName', args);
  const organizationsTable = args.organizationsTable || resolveTableName('OrganizationsTableName', args);
  const membersTable = args.membersTable || resolveTableName('OrgMembersTableName', args);

  console.log(`Stack:         ${args.stack} (${args.region}, profile ${args.profile})`);
  console.log(`Videos:        ${videosTable}`);
  console.log(`Organizations: ${organizationsTable}`);
  console.log(`Members:       ${membersTable}`);
  console.log(`Target org:    ${args.organizationId}${args.dryRun ? '  [DRY RUN]' : ''}\n`);

  const org = await doc.send(
    new GetCommand({ TableName: organizationsTable, Key: { orgId: args.organizationId } }),
  );
  if (!org.Item) {
    console.error(`Organization ${args.organizationId} does not exist in ${organizationsTable}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Organization:  ${org.Item.name} (${org.Item.slug})\n`);

  const members = await doc.send(
    new QueryCommand({
      TableName: membersTable,
      KeyConditionExpression: '#orgId = :orgId',
      // `role` is a DynamoDB reserved word, hence the alias.
      ProjectionExpression: 'userId, #role',
      ExpressionAttributeNames: { '#orgId': 'orgId', '#role': 'role' },
      ExpressionAttributeValues: { ':orgId': args.organizationId },
    }),
  );
  const memberIds = new Set((members.Items ?? []).map((m) => m.userId));

  const videos = [];
  let startKey;
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: videosTable,
        ExclusiveStartKey: startKey,
        ProjectionExpression: 'videoId, organizationId, ownerId, title',
      }),
    );
    videos.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const pending = videos.filter((v) => !v.organizationId);
  const already = videos.length - pending.length;

  console.log(`Videos:        ${videos.length} total, ${already} already in an organization, ${pending.length} to assign\n`);

  const owners = new Set(videos.map((v) => v.ownerId));
  const nonMembers = [...owners].filter((id) => !memberIds.has(id));

  let assigned = 0;
  let skipped = 0;

  for (const video of pending) {
    if (args.dryRun) {
      console.log(`would assign  ${video.videoId}  "${video.title ?? ''}"`);
      continue;
    }
    try {
      await doc.send(
        new UpdateCommand({
          TableName: videosTable,
          Key: { videoId: video.videoId },
          UpdateExpression: 'SET organizationId = :org, updatedAt = :now',
          // Don't clobber an organization assigned after this scan started.
          ConditionExpression: 'attribute_not_exists(organizationId)',
          ExpressionAttributeValues: { ':org': args.organizationId, ':now': Date.now() },
        }),
      );
      assigned += 1;
      console.log(`assigned  ${video.videoId}  "${video.title ?? ''}"`);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        skipped += 1;
        console.log(`skipped   ${video.videoId}  (already assigned by someone else)`);
        continue;
      }
      throw err;
    }
  }

  console.log(
    `\n${args.dryRun ? 'Would assign' : 'Assigned'}: ${args.dryRun ? pending.length : assigned}` +
      (skipped ? `, skipped: ${skipped}` : ''),
  );

  if (nonMembers.length > 0) {
    console.log(
      `\nWarning: ${nonMembers.length} video owner(s) are not members of this organization:\n` +
        nonMembers.map((id) => `  - ${id}`).join('\n') +
        '\nThey keep access to their own uploads, but will not see the rest of the' +
        "\norganization's library until they are added as members.",
    );
  }
}

main().catch((err) => {
  console.error('\nBackfill failed:', err.message ?? err);
  process.exitCode = 1;
});
