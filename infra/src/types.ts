/**
 * The shapes the generated infrastructure table is made of.
 *
 * `src/generated/` is written by `scripts/generate-from-serverless.mjs`, which
 * read `services/api/serverless.yml` once and transcribed it — the function
 * table, the DynamoDB key schemas, and the per-table half of the IAM policy.
 * These are the types that transcription answers to.
 *
 * They are deliberately a *description* of the service rather than CDK objects:
 * it is what the service is, and the stacks decide what to do with it. That is
 * what makes the generated file the thing to read when a question is about the
 * API's shape (how many routes, which are public, what a table is keyed by)
 * rather than about CloudFormation.
 */

/** One HTTP route, as Serverless declared it under a function's `events`. */
export interface HttpRouteSpec {
  /** `spaces/{spaceId}/members/{userId}` — braces intact, as the YAML wrote it. */
  path: string;
  /** Upper-case, always: `GET`, `POST`, `OPTIONS`. */
  method: string;
  /**
   * Whether the Cognito user-pool authorizer guards this route.
   *
   * Absent is a decision, not an oversight, and it is why the field is a
   * boolean rather than an optional authorizer name: the two public catalog
   * routes, all of `/v1` and the OAuth token endpoint carry no authorizer, for
   * the reason written out in the stacks. Those handlers authenticate
   * themselves.
   */
  authorized: boolean;
}

/** An S3 notification, as Serverless declared it under `events`. */
export interface S3EventSpec {
  /** The logical id of the bucket in this generated table. */
  bucket: string;
  /** `s3:ObjectCreated:*` and friends. */
  events: string[];
  prefix?: string;
  suffix?: string;
}

/**
 * An EventBridge (CloudWatch Events) rule.
 *
 * `detail` is the `detail:` filter, which the rules below use to react to one
 * job's lifecycle rather than to every event on the bus.
 */
export interface EventBridgeSpec {
  source: string[];
  detailType: string[];
  detail?: Record<string, string[]>;
}

/** One Lambda, and everything the gateway and the event sources wire to it. */
export interface FunctionSpec {
  /**
   * The Serverless function key, kept verbatim.
   *
   * It is what the deployed Lambda used to be named after
   * (`play-backend-dev-<key>`), so it is the string to search the old stack's
   * logs and metrics by. The CDK function is named `play-<stage>-<key>` — a
   * different name on purpose, because the two run side by side during the
   * cutover and a Lambda name is unique per account.
   */
  key: string;
  /** Entry point relative to `services/api`: `src/functions/videos/list-videos.ts`. */
  entry: string;
  /** The exported symbol in the bundle. `handler` for every function today. */
  handlerExport: string;
  /** Seconds. The service default is 29; a few processing jobs raise it. */
  timeout: number;
  memorySize: number;
  description?: string;
  /** Variables this function adds to the shared set — rarely used. */
  environment?: Record<string, string>;
  /**
   * Set when the function does not use the shared execution role.
   *
   * One function does: `link-federated-user`, whose role may call
   * `AdminLinkProviderForUser`, which can attach an external identity to any
   * local account. It is the only function that needs it, so it is the only
   * function that has it.
   */
  ownRole?: boolean;
  http: HttpRouteSpec[];
  s3: S3EventSpec[];
  eventBridge: EventBridgeSpec[];
}

/** A DynamoDB key attribute. */
export interface KeyAttribute {
  name: string;
  type: 'S' | 'N' | 'B';
}

/** A key schema entry: the attribute and whether it is the partition key. */
export interface KeySchemaEntry {
  name: string;
  keyType: 'HASH' | 'RANGE';
}

/** A global secondary index, transcribed as the table declares it. */
export interface SecondaryIndexSpec {
  name: string;
  keySchema: KeySchemaEntry[];
  /** `true` for `ProjectionType: ALL`, `false` for `KEYS_ONLY`. */
  projectAll: boolean;
  nonKeyAttributes?: string[];
}

/**
 * One table.
 *
 * The key schemas are here because they are the one part of this service that
 * cannot be recovered from anywhere else once the Serverless template is gone:
 * a table's name is in CloudFormation, but which attribute is its partition key,
 * and which indexes exist over it, is only in this file.
 */
export interface TableSpec {
  /** The legacy logical id — `VideosTable` — which is also its CDK construct id. */
  id: string;
  /** The environment variable every handler reads this table's name from. */
  envVar: string;
  billingMode: 'PAY_PER_REQUEST';
  attributeDefinitions: KeyAttribute[];
  keySchema: KeySchemaEntry[];
  globalSecondaryIndexes: SecondaryIndexSpec[];
  /**
   * The actions the shared execution role is granted on this table.
   *
   * Transcribed from the legacy `provider.iam.role.statements`, one entry per
   * table, because each table appears in exactly one statement there. Widening
   * one is a decision; the CDK app turns each of these into its own policy
   * statement so that narrowing one is a local edit.
   */
  actions: string[];
  /**
   * Whether the grant included the table's indexes.
   *
   * Not cosmetic: querying a global secondary index is a `Query` against the
   * *index*, which is a different resource as far as IAM is concerned. A grant
   * without it is a table whose listings work and whose lookups do not.
   */
  grantsIndexes: boolean;
}
