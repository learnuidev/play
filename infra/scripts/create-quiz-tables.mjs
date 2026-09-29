#!/usr/bin/env node
/**
 * Creates the three tables the question model uses — and the only tables in this
 * service that no deploy can create.
 * **Run this once, in each stage, before deploying the API.**
 *
 * ## Why this is a script and not a stack
 *
 * Every other table exists already and is **imported** by `PlayDataStack`
 * (`Table.fromTableName`), because a `cdk deploy` that tried to create a table
 * whose name is already taken fails with `already exists` — or, worse, replaces
 * it, and a replaced table is an empty table. Imported means unmanaged, which is
 * what makes deploying safe here and also what makes "the stack creates a new
 * table" not an option: the ownership flag is all-or-nothing, and turning it on
 * today would try to create all twenty-five tables under new names.
 *
 * So the tables added since the migration are created by this script, once, and
 * then imported like the rest:
 *
 * | Table | What it holds |
 * | --- | --- |
 * | `QuestionsTable` | the questions, each in a bank and about a lesson |
 * | `QuestionBanksTable` | the banks an organization owns |
 * | `QuizQuestionsTable` | which questions each quiz asks, and in what order |
 *
 * ## What it reads
 *
 * The key schemas come out of `src/generated/service.ts` rather than from this
 * file, so there is one description of each table and it is the one the stacks
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
 * ## Tables that already exist with the wrong shape
 *
 * A table that exists but whose keys do not match the spec is a table this
 * script refuses to touch — unless it is **empty** and `--recreate` was asked
 * for, which deletes and rebuilds it. That exists for one honest reason: the
 * question model was reshaped while the feature was still being built and before
 * anything was in it. It is not a migration tool. A table with rows in it is a
 * table to copy into a new one, by hand, on purpose.
 *
 * Usage:
 *   node infra/scripts/create-quiz-tables.mjs [options]
 *
 * Options:
 *   --stage=<name>    Backend stage  (default: dev)
 *   --profile=<name>  AWS profile    (default: scripts/api-config.env)
 *   --region=<name>   AWS region     (default: us-east-1)
 *   --plan            Print what would be created, change nothing
 *   --recreate        Rebuild a mismatched table **when it is empty**
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

/** The tables this script owns, in the order it reports them. */
const TABLE_IDS = ['QuestionsTable', 'QuestionBanksTable', 'QuizQuestionsTable'];

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
const recreate = args.includes('--recreate');
const assumeYes = args.includes('--yes');

/**
 * The physical name, following the convention the stacks use when they *do*
 * create a table (`play-<stage>-<kebab-case id>`), so a name from this script
 * and a name from a future `ownership.tables: true` are the same name.
 */
const kebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const nameOf = (id) => getArg('name', `play-${stage}-${kebab(id)}`);

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

/** Blocks this thread for a moment — there is no async work here to yield to. */
const sleep = (seconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

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
  if (at === -1) throw new Error(`src/generated/service.ts has no table ${id}`);

  const start = source.lastIndexOf('{', at);
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

/** A table's spec, as the deploy sees it and as this script creates it. */
function loadSpec(id) {
  const { keySchema, globalSecondaryIndexes, typeOf } = readSchema(
    tableSpecSource(serviceSource, id),
    id,
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

  return { id, name: nameOf(id), keySchema, globalSecondaryIndexes, attributeDefinitions };
}

const describe = (name) => aws(['dynamodb', 'describe-table', '--table-name', name], { optional: true });

/** How an existing table differs from the spec, in sentences a person can read. */
function differences(spec, table) {
  const problems = [];

  const liveKeys = (table.KeySchema ?? [])
    .sort((a, b) => (a.KeyType === 'HASH' ? -1 : 1))
    .map((key) => `${key.AttributeName} ${key.KeyType}`)
    .join(', ');
  const wantedKeys = spec.keySchema.map((key) => `${key.name} ${key.keyType}`).join(', ');
  if (liveKeys !== wantedKeys) problems.push(`keys are ${liveKeys}, expected ${wantedKeys}`);

  const liveIndexes = new Map((table.GlobalSecondaryIndexes ?? []).map((i) => [i.IndexName, i]));
  for (const index of spec.globalSecondaryIndexes) {
    const live = liveIndexes.get(index.name);
    if (!live) {
      problems.push(`no index ${index.name}`);
      continue;
    }
    const liveIndexKeys = (live.KeySchema ?? [])
      .sort((a, b) => (a.KeyType === 'HASH' ? -1 : 1))
      .map((key) => `${key.AttributeName} ${key.KeyType}`)
      .join(', ');
    const wantedIndexKeys = [
      `${index.hash} HASH`,
      ...(index.range ? [`${index.range} RANGE`] : []),
    ].join(', ');
    if (liveIndexKeys !== wantedIndexKeys) {
      problems.push(`${index.name} keys are ${liveIndexKeys}, expected ${wantedIndexKeys}`);
    }
  }

  for (const name of liveIndexes.keys()) {
    if (!spec.globalSecondaryIndexes.some((index) => index.name === name)) {
      problems.push(`an index ${name} the spec does not have`);
    }
  }

  return problems;
}

/** Whether point-in-time recovery is on for a table. */
function recoveryStatus(name) {
  const backups = aws(['dynamodb', 'describe-continuous-backups', '--table-name', name], {
    optional: true,
  });
  return backups?.ContinuousBackupsDescription?.PointInTimeRecoveryDescription
    ?.PointInTimeRecoveryStatus;
}

/**
 * Point-in-time recovery, on from the first write: every other table in this
 * service has it, and these should not be the exception.
 *
 * Retried, because a table that was created moments ago refuses this for a while
 * with `Backups are being enabled for the table. Please retry later` — a sentence
 * about a subsystem settling, not about anything being wrong. It is also the one
 * step allowed to fail without failing the run: the tables are what the deploy
 * needs, and the script says what is missing so running it again is obvious.
 */
function ensurePointInTimeRecovery(name) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    if (recoveryStatus(name) === 'ENABLED') return 'ENABLED';

    try {
      aws([
        'dynamodb',
        'update-continuous-backups',
        '--table-name',
        name,
        '--point-in-time-recovery-specification',
        'PointInTimeRecoveryEnabled=true',
      ]);
      return 'ENABLED';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/being enabled|retry later|Table not found/i.test(message)) {
        console.log(`  ! could not turn on point-in-time recovery: ${message}`);
        return 'FAILED';
      }
      if (attempt === 5) return 'FAILED';
      console.log(`  … still settling, retrying (${attempt}/5)`);
      sleep(6);
    }
  }

  return 'FAILED';
}

const specs = TABLE_IDS.map(loadSpec);

console.log(`Stage:   ${stage} (profile: ${profile}, region: ${region})\n`);

for (const spec of specs) {
  console.log(`${spec.id}  →  ${spec.name}`);
  console.log(`  keys:  ${spec.keySchema.map((k) => `${k.name} (${k.keyType})`).join(', ')}`);
  for (const index of spec.globalSecondaryIndexes) {
    console.log(
      `  index: ${index.name} (${index.hash}${index.range ? ` + ${index.range}` : ''}, ` +
        `${index.projectAll ? 'ALL' : 'KEYS_ONLY'})`,
    );
  }
}

console.log('');

let existing = specs.map((spec) => describe(spec.name));
let changed = false;

for (const [position, spec] of specs.entries()) {
  const table = existing[position]?.Table;

  if (table && differences(spec, table).length === 0) {
    console.log(`${spec.name}: already there, and it matches.`);
    continue;
  }

  if (table) {
    const problems = differences(spec, table);
    const items = table.ItemCount ?? 0;

    console.log(`${spec.name}: exists, but does not match —`);
    for (const problem of problems) console.log(`  - ${problem}`);

    if (!recreate) {
      console.log('  Not touching it. Pass --recreate to rebuild it (only if it is empty).\n');
      continue;
    }
    if (items > 0) {
      console.error(
        `\n${spec.name} has ${items} item(s) in it. This script will not delete data. ` +
          'Copy the rows into a new table by hand, then point the config at it.',
      );
      process.exit(1);
    }

    console.log('  It is empty, so it can be rebuilt.');
    changed = true;

    if (plan) {
      console.log('  (--plan: not doing it)\n');
      continue;
    }

    console.log('  Deleting and recreating…');
    aws(['dynamodb', 'delete-table', '--table-name', spec.name]);
    aws(['dynamodb', 'wait', 'table-not-exists', '--table-name', spec.name]);
    existing[position] = undefined;
  }

  if (existing[position]?.Table) continue;

  changed = true;
  if (plan) {
    console.log(`${spec.name}: would be created.\n`);
    continue;
  }

  if (!assumeYes) {
    console.log(`\nWould create ${spec.name}. Re-run with --yes to do it, or --plan to look.`);
    process.exit(0);
  }

  console.log(`${spec.name}: creating…`);
  aws([
    'dynamodb',
    'create-table',
    '--table-name',
    spec.name,
    '--billing-mode',
    'PAY_PER_REQUEST',
    '--attribute-definitions',
    // The CLI takes `AttributeName`/`AttributeType` here while the key schemas
    // below take `AttributeName`/`KeyType` — two shapes for the same idea, and
    // the one place this script has to say so.
    JSON.stringify(
      spec.attributeDefinitions.map((attribute) => ({
        AttributeName: attribute.name,
        AttributeType: attribute.type,
      })),
    ),
    '--key-schema',
    JSON.stringify(spec.keySchema.map((k) => ({ AttributeName: k.name, KeyType: k.keyType }))),
    ...(spec.globalSecondaryIndexes.length > 0
      ? [
          '--global-secondary-indexes',
          JSON.stringify(
            spec.globalSecondaryIndexes.map((index) => ({
              IndexName: index.name,
              KeySchema: [
                { AttributeName: index.hash, KeyType: 'HASH' },
                ...(index.range ? [{ AttributeName: index.range, KeyType: 'RANGE' }] : []),
              ],
              Projection: { ProjectionType: index.projectAll ? 'ALL' : 'KEYS_ONLY' },
            })),
          ),
        ]
      : []),
  ]);

  // Waited for before anything is done *to* the table: a create returns as soon
  // as it is accepted, and the next call against a name that is not visible yet
  // fails with `TableNotFoundException` — which reads like a mistake rather than
  // a moment of eventual consistency.
  console.log('  waiting for it to appear…');
  aws(['dynamodb', 'wait', 'table-exists', '--table-name', spec.name]);
  existing[position] = describe(spec.name);
}

if (plan) {
  console.log(changed ? '\n--plan: nothing was changed.' : '\nNothing to do.');
  process.exit(0);
}

// Point-in-time recovery, for every table — checked rather than assumed, and a
// step of its own so re-running this repairs a table created without it.
console.log('');
for (const spec of specs) {
  const recovery = ensurePointInTimeRecovery(spec.name);
  console.log(
    `${spec.name}: point-in-time recovery ${recovery === 'ENABLED' ? 'is on' : 'is NOT on — re-run this once the table has settled'}`,
  );
}

// The config file is what the data stack imports the tables *by*, so the names
// have to be recorded before any deploy can reference them. Written here rather
// than by `import-state.mjs`, which discovers tables in CloudFormation and these
// are in no stack: `ownership.tables` is false, so CDK never creates them and
// cannot see them.
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
config.existing ??= {};
config.existing.tables ??= {};

let wrote = false;
for (const spec of specs) {
  if (config.existing.tables[spec.id] === spec.name) continue;
  config.existing.tables[spec.id] = spec.name;
  wrote = true;
}

if (wrote) {
  // Sorted, because that is how the file is written and a new key appended to
  // the end of an alphabetical list reads as an exception.
  config.existing.tables = Object.fromEntries(
    Object.entries(config.existing.tables).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, configFile)}: ${TABLE_IDS.join(', ')}`);
} else {
  console.log(`\n${path.relative(ROOT, configFile)} already names all three.`);
}

console.log('\nNext: deploy the API.');
