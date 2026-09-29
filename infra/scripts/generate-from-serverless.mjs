#!/usr/bin/env node
/**
 * Transcribes `services/api/serverless.yml` into `infra/src/generated/service.ts`.
 *
 * This is a one-shot migration tool. It ran when the backend moved from
 * Serverless Framework to CDK, and it is kept because it is the record of how
 * the generated file below was derived: every function, every route, every key
 * schema, and every per-table IAM action in it came from the YAML by this
 * script, not from a person reading 3,093 lines.
 *
 * What it deliberately preserves beyond the mechanical parts:
 *
 * - **The comments.** Each function and each table in the YAML carries the
 *   reasoning for what it is — why a route has no authorizer, why a table has
 *   two indexes, why one function has a role of its own. That prose is the
 *   repository's documentation of its own backend, and deleting the YAML would
 *   delete it. It is carried across verbatim, attached to the same entry.
 * - **The function keys**, even where they disagree with the file beside them
 *   (`create-lesson-comment` serves `lesson-comments.ts`). The key is what the
 *   deployed Lambda was named after, so it is what the old stack's logs are
 *   searched by.
 *
 * Run it with `npm run generate --workspace play-infra`. It needs the YAML,
 * which no longer exists in a migrated repository — so in a fresh clone it
 * exits with a message saying so rather than failing obscurely.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SOURCE = path.join(ROOT, 'services', 'api', 'serverless.yml');
const OUT = path.join(HERE, '..', 'src', 'generated', 'service.ts');

if (!fs.existsSync(SOURCE)) {
  console.error(
    [
      `No ${path.relative(ROOT, SOURCE)} to read.`,
      '',
      'This script exists to transcribe that file once. The migration that used it',
      'is finished, and the file it read was deleted. The output it produced —',
      'infra/src/generated/service.ts — is the backend now; edit that instead.',
    ].join('\n'),
  );
  process.exit(1);
}

// --- parsing -----------------------------------------------------------------
//
// The YAML uses CloudFormation short-form tags (`!Ref`, `!GetAtt`, `!Sub`, …).
// The `yaml` package refuses unknown tags by default, and a plain `parse` would
// therefore fail on the first one. Each tag is defined here as the long form it
// is shorthand for, so the parsed document is plain data that can be walked.
//
// Scalars and sequences need separate entries: a tag registered without
// `collection` only accepts a scalar, and `!GetAtt` appears as both
// (`!GetAtt VideosBucket.Arn` beside `!If [ … ]`).

const TAG_KEYS = {
  Ref: 'Ref',
  Condition: 'Condition',
};

const COLLECTION_TAGS = ['If', 'And', 'Not', 'Equals', 'Join', 'Split', 'Select', 'FindInMap', 'Base64', 'GetAZs', 'Cidr', 'ImportValue', 'Sub', 'Transform', 'Length', 'ToJsonString', 'GetAtt', 'Ref', 'Condition'];

const customTags = [];

for (const name of COLLECTION_TAGS) {
  // A sequence form: `!If [Cond, A, B]` becomes `{ 'Fn::If': [ … ] }`.
  customTags.push({
    tag: `!${name}`,
    collection: 'seq',
    resolve: (value) => ({ [`Fn::${name}`]: value }),
  });
}

for (const name of [...COLLECTION_TAGS, ...Object.keys(TAG_KEYS)]) {
  customTags.push({
    tag: `!${name}`,
    resolve: (value) => {
      // `!GetAtt A.B` and `!GetAtt [A, B]` are the same thing; both are read
      // here as the dotted string, which is the form the rest of this script
      // matches on.
      if (name === 'GetAtt' && typeof value === 'string') {
        return { 'Fn::GetAtt': value };
      }
      return { [TAG_KEYS[name] ?? `Fn::${name}`]: value };
    },
  });
}

const doc = YAML.parseDocument(fs.readFileSync(SOURCE, 'utf8'), { customTags });
if (doc.errors.length > 0) {
  console.error('Could not parse serverless.yml:');
  for (const err of doc.errors) console.error(`  ${err.message}`);
  process.exit(1);
}

const config = doc.toJS();
const node = doc.contents;

/** The mapping node for a top-level key, so comments can be read off its pairs. */
function mappingNode(key) {
  if (!node || node.items === undefined) return undefined;
  const pair = node.items.find((p) => p.key && p.key.value === key);
  return pair && pair.value && pair.value.items ? pair.value : undefined;
}

/**
 * The comment block written above a key in the YAML, as an array of lines.
 *
 * This is the whole reason the script reads the document rather than the parsed
 * object: `toJS` throws the comments away, and the comments are the point.
 */
function commentAbove(mapping, key) {
  if (!mapping) return [];
  const pair = mapping.items.find((p) => p.key && p.key.value === key);
  if (!pair) return [];
  const raw = (pair.key.commentBefore || '').replace(/^\n+/, '');
  if (!raw) return [];
  return raw.split('\n').map((line) => line.replace(/^#\s?/, '').replace(/\s+$/, ''));
}

/** Those lines as a JSDoc block, or as nothing at all when there were none. */
function block(lines, indent) {
  if (lines.length === 0) return [];
  const pad = ' '.repeat(indent);
  return [
    `${pad}/**`,
    ...lines.map((line) => `${pad} * ${line}`.replace(/\s+$/, '').replace(/\*\//g, '*\\/')),
    `${pad} */`,
  ];
}

// --- the document ------------------------------------------------------------

const provider = config.provider ?? {};
const resources = (config.resources && config.resources.Resources) || {};
const functionsConfig = config.functions ?? {};

const DEFAULT_TIMEOUT = provider.timeout ?? 29;
const DEFAULT_MEMORY = provider.memorySize ?? 512;

const tablesInResources = new Map();
for (const [id, resource] of Object.entries(resources)) {
  if (resource && resource.Type === 'AWS::DynamoDB::Table') {
    tablesInResources.set(id, resource);
  }
}

/** `{ Ref: 'VideosTable' }` for a table logical id, or undefined for anything else. */
function referencedId(value) {
  if (value && typeof value === 'object' && typeof value.Ref === 'string') return value.Ref;
  return undefined;
}

/** `{ 'Fn::GetAtt': 'VideosTable.Arn' }` → `'VideosTable'`. */
function getAttId(value) {
  if (value && typeof value === 'object' && typeof value['Fn::GetAtt'] === 'string') {
    return value['Fn::GetAtt'].split('.')[0];
  }
  return undefined;
}

/** `{ 'Fn::Sub': '${VideosTable.Arn}/index/*' }` → `'VideosTable'`. */
function subId(value) {
  if (value && typeof value === 'object' && typeof value['Fn::Sub'] === 'string') {
    const match = /^\$\{([A-Za-z0-9]+)\.Arn\}/.exec(value['Fn::Sub']);
    return match ? match[1] : undefined;
  }
  return undefined;
}

const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

// --- tables ------------------------------------------------------------------

/**
 * Each table's IAM actions, keyed by logical id.
 *
 * The legacy policy grouped several tables under one statement; a table appears
 * in exactly one statement, so the actions it was granted are that statement's
 * actions and nothing has to be merged. `grantsIndexes` records whether the
 * statement also named `${Table.Arn}/index/*`, which is what makes a query
 * against a global secondary index allowed.
 */
const grantsByTable = new Map();
const statements = (((provider.iam || {}).role || {}).statements) || [];

for (const statement of statements) {
  const actions = list(statement.Action);
  const resourceList = list(statement.Resource);

  for (const resource of resourceList) {
    const id = getAttId(resource) ?? subId(resource);
    if (!id || !tablesInResources.has(id)) continue;

    const existing = grantsByTable.get(id) ?? { actions: new Set(), grantsIndexes: false };
    for (const action of actions) existing.actions.add(action);
    if (typeof resource === 'object' && resource['Fn::Sub']) existing.grantsIndexes = true;
    grantsByTable.set(id, existing);
  }
}

/** Which environment variable carries each table's name. */
const envVarByTable = new Map();
for (const [name, value] of Object.entries(provider.environment ?? {})) {
  const id = referencedId(value);
  if (id && tablesInResources.has(id)) envVarByTable.set(id, name);
}

const tableNodes = mappingNode('resources');

function keySchemaOf(properties) {
  return (properties.KeySchema ?? []).map((entry) => ({
    name: entry.AttributeName,
    keyType: entry.KeyType,
  }));
}

function attributeDefinitionsOf(properties) {
  return (properties.AttributeDefinitions ?? []).map((entry) => ({
    name: entry.AttributeName,
    type: entry.AttributeType,
  }));
}

function indexesOf(properties) {
  return (properties.GlobalSecondaryIndexes ?? []).map((index) => ({
    name: index.IndexName,
    keySchema: keySchemaOf(index),
    projectAll: (index.Projection ?? {}).ProjectionType === 'ALL',
    ...(index.Projection && index.Projection.NonKeyAttributes
      ? { nonKeyAttributes: index.Projection.NonKeyAttributes }
      : {}),
  }));
}

const tableEntries = [...tablesInResources.entries()].map(([id, resource]) => {
  const properties = resource.Properties ?? {};
  const grant = grantsByTable.get(id) ?? { actions: new Set(), grantsIndexes: false };
  return {
    id,
    envVar: envVarByTable.get(id),
    properties,
    actions: [...grant.actions].sort(),
    grantsIndexes: grant.grantsIndexes,
    comments: commentAbove(tableNodes, id),
  };
});

const tablesWithoutEnvVar = tableEntries.filter((entry) => !entry.envVar);
if (tablesWithoutEnvVar.length > 0) {
  console.error(
    `Tables with no environment variable: ${tablesWithoutEnvVar.map((t) => t.id).join(', ')}`,
  );
  process.exit(1);
}

const tablesWithoutGrants = tableEntries.filter((entry) => entry.actions.length === 0);
if (tablesWithoutGrants.length > 0) {
  console.error(
    `Tables with no IAM grant: ${tablesWithoutGrants.map((t) => t.id).join(', ')}`,
  );
  process.exit(1);
}

// --- functions ---------------------------------------------------------------

const functionNodes = mappingNode('functions');

function httpRoutesOf(events) {
  return events
    .filter((event) => event && event.http)
    .map((event) => ({
      path: String(event.http.path),
      method: String(event.http.method).toUpperCase(),
      authorized: event.http.authorizer !== undefined,
    }));
}

function s3EventsOf(events) {
  return events
    .filter((event) => event && event.s3)
    .map((event) => {
      const rules = event.s3.rules ?? [];
      const prefix = rules.find((rule) => rule.prefix !== undefined);
      const suffix = rules.find((rule) => rule.suffix !== undefined);
      return {
        bucket: referencedId(event.s3.bucket) ?? String(event.s3.bucket),
        events: list(event.s3.event),
        ...(prefix ? { prefix: String(prefix.prefix) } : {}),
        ...(suffix ? { suffix: String(suffix.suffix) } : {}),
      };
    });
}

function eventBridgeOf(events) {
  return events
    .filter((event) => event && event.cloudwatchEvent)
    .map((event) => {
      const pattern = event.cloudwatchEvent.event ?? {};
      return {
        source: list(pattern.source).map(String),
        detailType: list(pattern['detail-type']).map(String),
        ...(pattern.detail ? { detail: pattern.detail } : {}),
      };
    });
}

const functionEntries = Object.entries(functionsConfig).map(([key, definition]) => {
  const [entryPath, handlerExport] = String(definition.handler).split('.');
  const events = list(definition.events);

  // `role: !GetAtt LinkFederatedUserRole.Arn` — a function with an execution
  // role of its own rather than the shared one.
  const ownRole = definition.role !== undefined;

  return {
    key,
    entry: `${entryPath}.ts`,
    handlerExport: handlerExport ?? 'handler',
    timeout: definition.timeout ?? DEFAULT_TIMEOUT,
    memorySize: definition.memorySize ?? DEFAULT_MEMORY,
    description: definition.description,
    environment: definition.environment,
    ownRole,
    http: httpRoutesOf(events),
    s3: s3EventsOf(events),
    eventBridge: eventBridgeOf(events),
    comments: commentAbove(functionNodes, key),
  };
});

// --- emit --------------------------------------------------------------------

const lines = [];

lines.push('/**');
lines.push(' * The backend, as data.');
lines.push(' *');
lines.push(' * Generated from `services/api/serverless.yml` by');
lines.push(' * `infra/scripts/generate-from-serverless.mjs`. **Do not edit by hand** —');
lines.push(' * the script is the only thing that knows how to reproduce this file, and it');
lines.push(' * can no longer be re-run, because the YAML it read was deleted when the');
lines.push(' * migration finished. This file is the backend now.');
lines.push(' *');
lines.push(' * Two things live here that are worth knowing about before reading further:');
lines.push(' *');
lines.push(' * - **The comments came across.** Every function and every table below carries');
lines.push(' *   the reasoning that was written above it in the YAML — why a route has no');
lines.push(' *   authorizer, why a table has the indexes it has, why one function has a role');
lines.push(' *   of its own. They are attached to the same entry they were attached to');
lines.push(' *   there, and they are the reason this file is long.');
lines.push(' * - **The function keys are the deployed names.** `create-lesson-comment`');
lines.push(' *   serves `lesson-comment.ts`, and the key is not wrong: it is what the old');
lines.push(' *   stack\'s Lambda, log group and metrics are named after, so it is the string');
lines.push(' *   to search them by.');
lines.push(' */');
lines.push('');
lines.push("import type { FunctionSpec, TableSpec } from '../types';");
lines.push('');
lines.push('/** What every function gets unless it says otherwise. */');
lines.push('export const SERVICE_DEFAULTS = {');
lines.push(`  runtime: '${provider.runtime}' as const,`);
lines.push(`  timeout: ${DEFAULT_TIMEOUT},`);
lines.push(`  memorySize: ${DEFAULT_MEMORY},`);
lines.push('};');
lines.push('');

lines.push('export const TABLES: TableSpec[] = [');
for (const table of tableEntries) {
  lines.push(...block(table.comments, 2));
  lines.push('  {');
  lines.push(`    id: '${table.id}',`);
  lines.push(`    envVar: '${table.envVar}',`);
  lines.push("    billingMode: 'PAY_PER_REQUEST',");
  lines.push('    attributeDefinitions: [');
  for (const attribute of attributeDefinitionsOf(table.properties)) {
    lines.push(`      { name: '${attribute.name}', type: '${attribute.type}' },`);
  }
  lines.push('    ],');
  lines.push('    keySchema: [');
  for (const key of keySchemaOf(table.properties)) {
    lines.push(`      { name: '${key.name}', keyType: '${key.keyType}' },`);
  }
  lines.push('    ],');
  lines.push('    globalSecondaryIndexes: [');
  for (const index of indexesOf(table.properties)) {
    lines.push('      {');
    lines.push(`        name: '${index.name}',`);
    lines.push('        keySchema: [');
    for (const key of index.keySchema) {
      lines.push(`          { name: '${key.name}', keyType: '${key.keyType}' },`);
    }
    lines.push('        ],');
    lines.push(`        projectAll: ${index.projectAll},`);
    if (index.nonKeyAttributes) {
      lines.push(`        nonKeyAttributes: ${JSON.stringify(index.nonKeyAttributes)},`);
    }
    lines.push('      },');
  }
  lines.push('    ],');
  lines.push('    actions: [');
  for (const action of table.actions) lines.push(`      '${action}',`);
  lines.push('    ],');
  lines.push(`    grantsIndexes: ${table.grantsIndexes},`);
  lines.push('  },');
}
lines.push('];');
lines.push('');

lines.push('export const FUNCTIONS: FunctionSpec[] = [');
for (const fn of functionEntries) {
  lines.push(...block(fn.comments, 2));
  lines.push('  {');
  lines.push(`    key: '${fn.key}',`);
  lines.push(`    entry: '${fn.entry}',`);
  lines.push(`    handlerExport: '${fn.handlerExport}',`);
  lines.push(`    timeout: ${fn.timeout},`);
  lines.push(`    memorySize: ${fn.memorySize},`);
  if (fn.description) lines.push(`    description: ${JSON.stringify(fn.description)},`);
  if (fn.environment) lines.push(`    environment: ${JSON.stringify(fn.environment)},`);
  if (fn.ownRole) lines.push('    ownRole: true,');
  lines.push(`    http: ${JSON.stringify(fn.http)},`);
  lines.push(`    s3: ${JSON.stringify(fn.s3)},`);
  lines.push(`    eventBridge: ${JSON.stringify(fn.eventBridge)},`);
  lines.push('  },');
}
lines.push('];');
lines.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'));

const routes = functionEntries.reduce((sum, fn) => sum + fn.http.length, 0);
const authorized = functionEntries.reduce(
  (sum, fn) => sum + fn.http.filter((route) => route.authorized).length,
  0,
);
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${functionEntries.length} functions, ${routes} routes (${authorized} authorized)`);
console.log(`  ${tableEntries.length} tables`);
