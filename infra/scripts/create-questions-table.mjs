#!/usr/bin/env node
/**
 * Creates the `QuestionsTable` — the one table in this service that no other
 * deploy can create. **Run this once, in each stage, before deploying the API.**
 *
 * ## Why this is a script and not a stack
 *
 * Every other table exists already and is **imported** by `PlayDataStack`
 * (`Table.fromTableName`), because a `cdk deploy` that tried to create a table
 * whose name is already taken fails with `already exists` — or, worse, replaces
 * it, and a replaced table is an empty table. Imported means unmanaged, which is
 * what makes deploying safe here and also what makes "the stack creates a new
 * table" not an option: the ownership flag is all-or-nothing, and turning it on
 * today would try to create all twenty-three tables under new names.
 *
 * So the first table added since the migration is created by this script, once,
 * and then imported like the rest. It is idempotent: run it twice and the second
 * run finds the table, checks it, and records the name.
 *
 * ## What it reads
 *
 * The key schema comes out of `src/generated/service.ts` rather than from this
 * file, so there is one description of the table and it is the one the stacks
 * deploy against. A copy here would be a second answer to "what is this table
 * keyed by", and the failure mode of the two disagreeing is silent: a query
 * against an index that was never created throws at the first read, in
 * production, naming an index nobody remembers choosing.
 *
 * The reader is shaped to that file's own formatting — a table entry's
 * attributes, key schema and indexes as the generator wrote them. If the layout
 * changes it fails with a message saying so, rather than creating the wrong
 * table, and the fix is to teach the reader the new shape.
 *
 * Usage:
 *   node infra/scripts/create-questions-table.mjs [options]
 *
 * Options:
 *   --stage=<name>    Backend stage  (default: dev)
 *   --profile=<name>  AWS profile    (default: scripts/api-config.env)
 *   --region=<name>   AWS region     (default: us-east-1)
 *   --plan            Print what would be created, change nothing
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

/** The table this script exists for, and the logical id every file keys it by. */
const TABLE_ID = 'QuestionsTable';

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

const args = process.argv.slice(2);

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

/**
 * The physical name, following the convention the stacks use when they *do*
 * create a table (`play-<stage>-<kebab-case id>`), so a name from this script
 * and a name from a future `ownership.tables: true` are the same name.
 */
const kebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const tableName = getArg('name', `play-${stage}-${kebab(TABLE_ID)}`);

const configFile = path.join(INFRA, 'config', `play-${stage}.json`);
if (!fs.existsSync(configFile)) {
  console.error(
    `No ${path.relative(ROOT, configFile)}. Discover the deployed resources first:\n\n` +
      '  npm run import-state --workspace play-infra\n',
  );
  process.exit(1);
}

function aws(argv, { optional = false } = {}) {
  try {
    const out = execFileSync(
      'aws',
      [...argv, '--profile', profile, '--region', region, '--output', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return out.trim() === '' ? {} : JSON.parse(out);
  } catch (err) {
    if (optional) return undefined;
    throw new Error(`${err.stderr?.toString().trim() || err.message}`);
  }
}

/**
 * One table's entry out of the generated service table, as text.
 *
 * Located by its `id:` and closed by brace counting rather than by a regex,
 * because the entry contains nested objects and a regex that matched "up to the
 * next `},`" would stop inside the first index.
 */
function tableSpecSource(source, id) {
  const marker = `id: '${id}'`;
  const at = source.indexOf(marker);
  if (at === -1) {
    throw new Error(`src/generated/service.ts has no table ${id}`);
  }

  let start = source.lastIndexOf('{', at);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`${id}'s entry in src/generated/service.ts is not closed`);
}

/**
 * The key schemas the table has to be created with.
 *
 * Attributes first, then the primary key, then the indexes — each read out of
 * the block by the exact shapes the generator writes. Anything missing is an
 * error rather than a default: a table created without its index is a table
 * whose reads fail later, and the point of this whole script is to get that
 * right once.
 */
function readSchema(block, id) {
  const [head, indexPart = ''] = block.split('globalSecondaryIndexes:');

  const typeOf = (name) => {
    const found = head.match(new RegExp(`\\{ name: '${name}', type: '([SNB])' \\}`));
    if (!found) throw new Error(`${id}: no attribute definition for '${name}'`);
    return found[1];
  };

  const keySchema = [...head.matchAll(/\{ name: '([^']+)', keyType: '(HASH|RANGE)' \}/g)].map(
    (match) => ({ name: match[1], keyType: match[2] }),
  );
  if (keySchema.length === 0) throw new Error(`${id}: no key schema found`);

  const globalSecondaryIndexes = [
    ...indexPart.matchAll(
      /name: '([^']+)',\s*keySchema: \[\s*\{ name: '([^']+)', keyType: 'HASH' \},\s*(?:\{ name: '([^']+)', keyType: 'RANGE' \},\s*)?\],\s*projectAll: (true|false)/g,
    ),
  ].map((match) => ({
    name: match[1],
    hash: match[2],
    range: match[3],
    projectAll: match[4] === 'true',
  }));

  return { keySchema, globalSecondaryIndexes, typeOf };
}

const serviceSource = fs.readFileSync(path.join(INFRA, 'src', 'generated', 'service.ts'), 'utf8');
const { keySchema, globalSecondaryIndexes, typeOf } = readSchema(
  tableSpecSource(serviceSource, TABLE_ID),
  TABLE_ID,
);

const attributeDefinitions = [];
for (const key of keySchema) attributeDefinitions.push({ name: key.name, type: typeOf(key.name) });
for (const index of globalSecondaryIndexes) {
  if (!attributeDefinitions.some((a) => a.name === index.hash)) {
    attributeDefinitions.push({ name: index.hash, type: typeOf(index.hash) });
  }
  if (index.range && !attributeDefinitions.some((a) => a.name === index.range)) {
    attributeDefinitions.push({ name: index.range, type: typeOf(index.range) });
  }
}

console.log(`Table:   ${tableName}`);
console.log(`Stage:   ${stage} (profile: ${profile}, region: ${region})`);
console.log(`Keys:    ${keySchema.map((k) => `${k.name} (${k.keyType})`).join(', ')}`);
for (const index of globalSecondaryIndexes) {
  console.log(
    `Index:   ${index.name} (${index.hash}${index.range ? ` + ${index.range}` : ''}, ` +
      `${index.projectAll ? 'ALL' : 'KEYS_ONLY'})`,
  );
}

const describe = () => aws(['dynamodb', 'describe-table', '--table-name', tableName], { optional: true });

let existing = describe();

if (existing?.Table) {
  console.log('\nThe table already exists — nothing to create.');
} else if (plan) {
  console.log('\nWould create it. Re-run without --plan to do it.');
  process.exit(0);
} else {
  if (!assumeYes) {
    console.log('\nAbout to create the table above. Re-run with --yes to confirm, or --plan to look.');
    process.exit(0);
  }

  console.log('\nCreating…');
  aws([
    'dynamodb',
    'create-table',
    '--table-name',
    tableName,
    '--billing-mode',
    'PAY_PER_REQUEST',
    '--attribute-definitions',
    JSON.stringify(attributeDefinitions),
    '--key-schema',
    JSON.stringify(keySchema.map((k) => ({ AttributeName: k.name, KeyType: k.keyType }))),
    '--global-secondary-indexes',
    JSON.stringify(
      globalSecondaryIndexes.map((index) => ({
        IndexName: index.name,
        KeySchema: [
          { AttributeName: index.hash, KeyType: 'HASH' },
          ...(index.range ? [{ AttributeName: index.range, KeyType: 'RANGE' }] : []),
        ],
        Projection: { ProjectionType: index.projectAll ? 'ALL' : 'KEYS_ONLY' },
      })),
    ),
  ]);

  // Point-in-time recovery is on from the first write, on every other table in
  // this service and on this one too. The legacy tables had to be brought up to
  // it by hand; there is no reason for a new one to start without it.
  aws([
    'dynamodb',
    'update-continuous-backups',
    '--table-name',
    tableName,
    '--point-in-time-recovery-specification',
    'PointInTimeRecoveryEnabled=true',
  ]);

  console.log('Waiting for it to become active…');
  aws(['dynamodb', 'wait', 'table-exists', '--table-name', tableName]);
  existing = describe();
}

const table = existing?.Table;
if (!table) {
  console.error('\nThe table could not be read back — run this again and it will say what it finds.');
  process.exit(1);
}
if (table.TableStatus !== 'ACTIVE') {
  console.log(`\nIt is ${table.TableStatus} — the API can be deployed once it is ACTIVE.`);
}

// The config file is what the data stack imports the table *by*, so the name has
// to be recorded before any deploy can reference it. Written here rather than by
// `import-state.mjs`, which discovers tables in CloudFormation and this one is
// in no stack: `ownership.tables` is false, so CDK never creates it and cannot
// see it.
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
config.existing ??= {};
config.existing.tables ??= {};

if (config.existing.tables[TABLE_ID] === table.TableName) {
  console.log(`\nconfig/play-${stage}.json already names it. Nothing to write.`);
} else {
  const previous = config.existing.tables[TABLE_ID];
  config.existing.tables[TABLE_ID] = table.TableName;

  // Sorted, because that is how the file is written and a new key appended to
  // the end of an alphabetical list reads as an exception.
  config.existing.tables = Object.fromEntries(
    Object.entries(config.existing.tables).sort(([a], [b]) => a.localeCompare(b)),
  );

  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(
    `\nWrote config/play-${stage}.json: existing.tables.${TABLE_ID} = ${table.TableName}` +
      (previous && previous !== table.TableName ? ` (was ${previous})` : ''),
  );
}

if (table.GlobalSecondaryIndexes?.some((index) => index.IndexStatus !== 'ACTIVE')) {
  console.log('\nIts index is still backfilling. Deploy once every index says ACTIVE.');
}

console.log('\nNext: deploy the API.');
