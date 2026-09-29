import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

import type { PlayConfig } from '../config';
import { importedResources } from '../config';
import { kebab } from '../naming';
import { TABLES } from '../generated/service';
import type { KeySchemaEntry, TableSpec } from '../types';

export interface PlayDataStackProps extends StackProps {
  config: PlayConfig;
}

/**
 * The DynamoDB tables — created for a new environment, imported for `dev`.
 *
 * ## Which of the two is `ownership.tables`
 *
 * **`true` — a new environment.** Every table is created, named
 * `play-<stage>-<table>`, empty, on-demand, with point-in-time recovery on from
 * the first write and `RETAIN` so a stack delete does not take the data. This is
 * what deploying a stage that has never existed does, and it is the default the
 * deploy console writes.
 *
 * **`false` — `dev`, and only `dev`.** Every table is imported with
 * `Table.fromTableName`. An imported table is *unmanaged*: CloudFormation does
 * not put it in this stack's template, will not change its properties, and will
 * not delete it. The tables are the product — courses, memberships, comments,
 * credentials — and they already exist, so creating one with an existing name to
 * "adopt" it would fail the deploy with `already exists` or, worse, replace it,
 * and a replaced table is an empty table.
 *
 * That is why `cdk deploy PlayDataStack-dev` on a fresh checkout is a no-op that
 * proves the account, the region and the names all line up — a useful thing to
 * be able to run. It is also why a new stage must **not** copy `dev`'s config:
 * `false` plus dev's table names is not a new environment, it is a second front
 * door to dev's database.
 *
 * The alternative to importing — `cdk import`, which puts the real resource
 * under CloudFormation's management — is deliberately not used yet: it cannot be
 * done while the legacy stack still owns these tables, and doing it wrong is how
 * a table gets replaced. Phase E of `docs/migration.md` is the day that changes.
 */
export class PlayDataStack extends Stack {
  /** Every table, keyed by the legacy logical id and by environment variable. */
  public readonly tables: Record<string, dynamodb.ITable>;

  constructor(scope: Construct, id: string, props: PlayDataStackProps) {
    super(scope, id, props);

    const { config } = props;
    this.tables = {};

    for (const spec of TABLES) {
      if (!config.ownership.tables) {
        const name = importedResources(config).tables[spec.id];
        if (!name) {
          throw new Error(
            `No physical name for ${spec.id} in infra/config/play-${config.stage}.json. ` +
              'Run `npm run import-state --workspace play-infra` to discover it.',
          );
        }
        this.tables[spec.id] = dynamodb.Table.fromTableName(this, spec.id, name);
        continue;
      }

      const table = new dynamodb.Table(this, spec.id, {
        tableName: `play-${config.stage}-${kebab(spec.id)}`,

        // The key schemas are the part of this service that cannot be recovered
        // from anywhere else once the generated table file is the only record of
        // them: a table's *name* is in CloudFormation, but which attribute is its
        // partition key, and which indexes are built over it, is here.
        partitionKey: toAttribute(spec, partitionKeyOf(spec.keySchema)),
        ...(spec.keySchema.some((key) => key.keyType === 'RANGE')
          ? { sortKey: toAttribute(spec, sortKeyOf(spec.keySchema)) }
          : {}),

        // Every table in this service is on-demand. Billing mode is the one
        // property that cannot be changed on a live table, so it is worth being
        // explicit that it is not a default being inherited.
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

        // A table that survives the stack, because the alternative is a typo away
        // from deleting the product. This is the property the legacy tables do
        // *not* have, which is what `infra/scripts/retain-legacy-stack.sh` is
        // about — and it is why the old stack cannot simply be deleted today.
        removalPolicy: RemovalPolicy.RETAIN,

        // Point-in-time recovery, on from the first write. The legacy tables do
        // not have it either; enabling it on them is part of the same hardening
        // script, and it is what makes "restore to five minutes ago" a real
        // answer for the half of this data that cannot be recreated.
        pointInTimeRecovery: true,
      });

      for (const index of spec.globalSecondaryIndexes) {
        table.addGlobalSecondaryIndex({
          indexName: index.name,
          partitionKey: toAttribute(spec, index.keySchema.find((key) => key.keyType === 'HASH')!),
          ...(index.keySchema.some((key) => key.keyType === 'RANGE')
            ? { sortKey: toAttribute(spec, index.keySchema.find((key) => key.keyType === 'RANGE')!) }
            : {}),
          // `KEYS_ONLY` is a real choice on three of these — the answer wanted is
          // a set of ids, and projecting the whole item to read them again would
          // be paying for the read twice.
          projectionType: index.projectAll
            ? dynamodb.ProjectionType.ALL
            : dynamodb.ProjectionType.KEYS_ONLY,
          ...(index.nonKeyAttributes ? { nonKeyAttributes: index.nonKeyAttributes } : {}),
        });
      }

      this.tables[spec.id] = table;
    }
  }
}

/**
 * A key schema entry as CDK wants it.
 *
 * The type is looked up in the table's own attribute definitions rather than
 * carried on the key entry, because that is where DynamoDB keeps it — a key
 * schema names an attribute, and the attribute is what says whether it is a
 * string or a number.
 */
function toAttribute(
  table: TableSpec,
  key: { name: string; keyType: 'HASH' | 'RANGE' },
): dynamodb.Attribute {
  const definition = table.attributeDefinitions.find((attribute) => attribute.name === key.name);
  if (!definition) {
    throw new Error(`${table.id}: key '${key.name}' has no attribute definition`);
  }

  const types = {
    S: dynamodb.AttributeType.STRING,
    N: dynamodb.AttributeType.NUMBER,
    B: dynamodb.AttributeType.BINARY,
  } as const;

  return { name: key.name, type: types[definition.type] };
}

function partitionKeyOf(schema: KeySchemaEntry[]): KeySchemaEntry {
  const key = schema.find((entry) => entry.keyType === 'HASH');
  if (!key) throw new Error('Table has no partition key');
  return key;
}

function sortKeyOf(schema: KeySchemaEntry[]): KeySchemaEntry {
  const key = schema.find((entry) => entry.keyType === 'RANGE');
  if (!key) throw new Error('Table has no sort key');
  return key;
}
