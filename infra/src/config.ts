import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_DIR } from './paths';

/**
 * What this deployment stands on, and what it is allowed to touch.
 *
 * The values come from `infra/config/play-<stage>.json`, which
 * `scripts/import-state.mjs` reads out of AWS once and commits. The CDK app does
 * not look anything up at synth time, and that is a decision rather than an
 * omission:
 *
 * - A synth that reaches AWS needs credentials and a network, so `cdk synth` —
 *   the thing that is supposed to be instant and local — stops being either.
 * - A lookup that misses does not fail. `StringParameter.valueFromLookup`
 *   returns the *parameter name* when the parameter does not exist, and that
 *   string is then baked into a hundred Lambdas' environments as a table name.
 *   The failure surfaces as a 500 at the first request.
 *
 * The names are also the one thing here a person should read before verifying a
 * change, and a file in the repository can be read.
 */

export interface ExistingResources {
  /**
   * Physical table names, keyed by the legacy logical id — `VideosTable` and so
   * on. The logical id is the key because it is also the CDK construct id and
   * the environment variable's name in `src/generated/service.ts`, so one string
   * ties the three together.
   */
  tables: Record<string, string>;
  videosBucket: string;
  cloudFrontLogsBucket?: string;
  cloudFrontDistributionId: string;
  cloudFrontDomain: string;
  cloudFrontPublicKeyId: string;
  userPoolId: string;
  userPoolClientId: string;
  userPoolDomain: string;
  googleSignInEnabled: boolean;
}

export interface MailSettings {
  fromAddress: string;
  appBaseUrl: string;
  marketplaceBaseUrl: string;
}

export interface AuthSettings {
  googleClientId: string;
  callbackUrls: string[];
  logoutUrls: string[];
}

/**
 * Whether a stack creates a stateful resource or imports the one that already
 * exists.
 *
 * **All three are `false` in a migrated repository**, and `false` is what you
 * want. An imported resource is unmanaged: CDK will not change its properties
 * and will not delete it — which is the entire point, because the alternative is
 * a table that CloudFormation replaces, and a replaced table is an empty table.
 *
 * Setting one to `true` means "create this instead of importing it". That is a
 * data migration, not a configuration change: read `docs/migration.md` phase E
 * before touching any of them.
 */
export interface Ownership {
  tables: boolean;
  media: boolean;
  auth: boolean;
}

export interface PlayConfig {
  stage: string;
  account: string;
  region: string;
  /**
   * The names of the resources this environment imports.
   *
   * **Absent on an environment that owns everything**, which is what a new stage
   * is: it imports nothing, so there is nothing to name. It is required exactly
   * to the extent that `ownership` says something is imported, and `validate`
   * checks it field by field rather than demanding the whole block.
   */
  existing?: ExistingResources;
  /**
   * What to call the two buckets a stage that **creates** its media gets.
   *
   * Absent by default, and absent is the better answer: an S3 bucket name is
   * unique across *every* AWS account, so `play-<stage>-videos` is a name some
   * other account may simply own — for a stage called `test`, one does — and
   * CloudFormation then fails early validation with "Resource of type
   * 'AWS::S3::Bucket' with identifier 'play-test-videos' already exists",
   * before anything is created.
   *
   * Left out, CloudFormation names each bucket itself: unique by construction,
   * and the physical name is not something a person needs to know, because
   * every consumer reads it from the stack — `VideosBucketName` is an output,
   * and the handlers get it in their environment. Set either field to keep a
   * name a stage already has (naming a bucket that exists is a *replacement*,
   * so a deployed stage freezes what it has) or to pick one deliberately.
   *
   * Only for a stage that creates its media: an imported one names its bucket
   * in `existing.videosBucket`, which is a physical name rather than a choice.
   */
  videosBucketName?: string;
  cloudFrontLogsBucketName?: string;
  mail: MailSettings;
  auth: AuthSettings;
  /** The *name* of the CloudFront signing key parameter. Never the key. */
  cloudFrontPrivateKeyParam: string;
  /** The *name* of the parameter holding that key's public half. */
  cloudFrontPublicKeyParam: string;
  /**
   * The *name* of the parameter holding the key's **CloudFront id** — the
   * `Key-Pair-Id` every signed URL carries.
   *
   * A parameter of its own rather than a line inside the public one, because the
   * two are written by different things at different times: the public half is
   * written *before* a deploy by `ensure-cloudfront-key.mjs`, and the id is
   * assigned by CloudFront to the key `PlayMediaStack` creates *during* one. A
   * stage that imports its distribution has the id already, as
   * `existing.cloudFrontPublicKeyId`, and the stack republishes it here — so the
   * handlers read one parameter name on every stage.
   *
   * Why the handlers read it at all, rather than being handed it in their
   * environment: a CloudFront public key is immutable, so rotating one is a
   * deploy that creates a **new** key with a new id. Passed across stacks, that
   * id is a CloudFormation export, a renamed export cannot be deleted while a
   * consumer still imports it, and the rotate-one-key deploy turns into a
   * two-stack dance. Read from here, a rotation is the stack that owns the key.
   */
  cloudFrontPublicKeyIdParam: string;
  /**
   * Which generation of this environment's CloudFront public key is current.
   *
   * CloudFront keys are **immutable**: `UpdatePublicKey` rejects a change to a
   * key's material or its name — "You cannot modify encoded material and name of
   * a public key once created" — and CloudFormation's resource schema for
   * `AWS::CloudFront::PublicKey` declares no `createOnlyProperties`, so it sends
   * exactly that update and the deploy fails with the generic "Invalid request
   * provided: AWS::CloudFront::PublicKey". Which is the failure this field
   * exists to route around: new material can only ever be a new *resource*, and
   * this string is part of the construct id and of the `Name` CloudFront sees,
   * so changing it is what makes the deploy create one.
   *
   * So rotating a key is: put the new pair at the parameters above (a name that
   * is new, or a deliberate `put-parameter` — `ensure-cloudfront-key.mjs` writes
   * an absent parameter and never overwrites one that is there), bump this, and
   * deploy. CloudFormation creates the new key, moves the key group to it, and
   * deletes the old one; the distribution never changes, because it trusts the
   * group rather than the key.
   */
  cloudFrontKeyVersion: string;
  /** The Secrets Manager secret a created pool reads the Google client secret from. */
  googleClientSecretName: string;
  /**
   * The Secrets Manager secret holding this environment's **Stripe API key** —
   * the `sk_…` that may be spent.
   *
   * A credential rather than a resource this app creates, which is why nothing
   * here declares an `AWS::SecretsManager::Secret`: a stack that created one would
   * own a value it did not know, and the console's write would then be a fight
   * with the next deploy rather than the way the value is set. The same division
   * the Google client secret has, for the same reason.
   */
  stripeSecretName: string;
  /**
   * The Secrets Manager secret holding the **webhook signing secret** — the
   * `whsec_…` this environment's endpoint signs with.
   *
   * A secret of its own rather than a second field in the one above, because the
   * two are rotated for different reasons and at different times: an API key is
   * rotated on somebody's schedule, and an endpoint's signing secret changes when
   * the endpoint is recreated. One document for both would make every rotation a
   * write of the *other* value too — and the console never reads a credential
   * back, so it could not even send the half it was not asked to change.
   */
  stripeWebhookSecretName: string;
  /**
   * The *name* of the SSM parameter holding the **publishable key**.
   *
   * A parameter rather than a secret, and String rather than SecureString,
   * because it is not secret: it is served to browsers — it is what a marketplace
   * page loads Stripe.js with — so burying it in Secrets Manager would mean a
   * `GetSecretValue` on the request path to read something anybody can see in a
   * page source.
   */
  stripePublishableKeyParam: string;
  ownership: Ownership;
}

/**
 * What a config that says nothing about ownership means.
 *
 * False for all three, because the configs that predate this field are `dev` and
 * the migrated stage — the ones that genuinely import. A stage written by the
 * console declares its own `ownership` and never reaches this default.
 */
export const IMPORT_EVERYTHING: Ownership = {
  tables: false,
  media: false,
  auth: false,
};

/** The same switch, with the "not stated" case resolved. */
export function ownershipOf(config: PlayConfig): Ownership {
  return config.ownership ?? IMPORT_EVERYTHING;
}

/** True when this environment creates all of its own stateful resources. */
export function ownsEverything(config: PlayConfig): boolean {
  const ownership = ownershipOf(config);
  return ownership.tables && ownership.media && ownership.auth;
}

/**
 * Where an environment's CloudFront signing key pair lives when the config does
 * not say.
 *
 * **Per stage**, like the Google client secret and unlike anything the config
 * discovers: the pair signs one environment's URLs, and one environment's
 * handlers have no business being able to mint URLs for another's distribution.
 * One pair per environment also means a compromised or rotated key is one
 * environment's problem.
 *
 * A *migrated* stage is the exception, and it says so in its own config: `dev`
 * imports the distribution the legacy key group already gates, so its private
 * half has to be the parameter holding the key that distribution was created
 * against — the shared `/play/cloudfront/private-key` — and no default can know
 * that. Which is why these are only defaults: a config that names its parameters
 * is read as it says.
 */
export function defaultCloudFrontPrivateKeyParam(stage: string): string {
  return `/play/${stage}/cloudfront/private-key`;
}

/** The public half of the same pair, which the media stack creates a key from. */
export function defaultCloudFrontPublicKeyParam(stage: string): string {
  return `/play/${stage}/cloudfront/public-key`;
}

/**
 * Where the id of the key that public half belongs to is published.
 *
 * Per stage like the other two, and for the same reason: the id names the key a
 * distribution trusts, and two environments whose handlers read the same id are
 * two environments signing with each other's keys. A migrated stage is the
 * exception in exactly the way it is for the pair — its config names the id in
 * `existing.cloudFrontPublicKeyId` — but the parameter it is republished to is
 * still this stage's own.
 */
export function defaultCloudFrontPublicKeyIdParam(stage: string): string {
  return `/play/${stage}/cloudfront/public-key-id`;
}

/** What a version has to look like to be a name and a construct id. */
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/;

/**
 * The generation a stage that has never rotated anything is on.
 *
 * `1` rather than absent, because the value is not a count of rotations — it is
 * a name, and a name that is sometimes missing is a name two halves of this app
 * would disagree about. A config written before this field existed deploys as
 * `1`, and the key it already has is *not* the key a stacked deploy would
 * create: that is deliberate. See the field's own note in `PlayConfig`.
 */
export const DEFAULT_CLOUD_FRONT_KEY_VERSION = '1';

/**
 * Where a **created** user pool reads the Google client secret from.
 *
 * Secrets Manager rather than SSM, and not by preference:
 * `AWS::Cognito::UserPoolIdentityProvider` rejects an SSM Secure reference in
 * `ProviderDetails.client_secret` outright — "SSM Secure reference is not
 * supported in: [...]" — and rejects it in `AWS::SecretsManager::Secret`'s
 * `SecretString` too, so the value cannot even be moved across declaratively.
 * A `secretsmanager` reference *is* accepted there.
 *
 * **Per stage**, unlike the CloudFront signing key: this is a credential an
 * environment is configured with rather than shared state, and the console's
 * Checklist tab writes one per environment. The name is derived from the stage
 * so two environments cannot overwrite each other's.
 */
export function googleClientSecretName(stage: string): string {
  return `play/${stage}/google-client-secret`;
}

/**
 * Where a stage's **Stripe** credentials live.
 *
 * **Per stage**, like the Google client secret, and unlike the media the product
 * shares: these are the keys a deployment charges with, so two environments
 * holding the same one are two environments spending one account's money — and a
 * staging deploy that took a real payment is a thing that must not be able to
 * happen by copying a config.
 *
 * The account *id* is deliberately not part of either name: an account has one,
 * it never changes, and a name that carried it would have to be rewritten the day
 * somebody's Stripe account is replaced — with the value already stored under the
 * old name being exactly what nobody would think to look for.
 */
export function stripeSecretName(stage: string): string {
  return `play/${stage}/stripe-secret-key`;
}

/**
 * The endpoint's signing secret, which is a different credential with a different
 * lifetime from the key above — see the field's own note in `PlayConfig`.
 */
export function stripeWebhookSecretName(stage: string): string {
  return `play/${stage}/stripe-webhook-secret`;
}

/** Where the publishable key — not a secret — is kept for the frontends to read. */
export function stripePublishableKeyParam(stage: string): string {
  return `/play/${stage}/stripe/publishable-key`;
}

/** Where `import-state.mjs` writes, and where this reads. */
export function configPath(stage: string): string {
  return path.join(CONFIG_DIR, `play-${stage}.json`);
}

/**
 * The names of the imported resources, for a stack that has decided to import.
 *
 * `loadConfig` has already refused a config that imports something and does not
 * name it, so reaching the throw here means a construct was handed a config
 * that never went through validation — worth a sentence rather than a
 * `undefined` in a bucket ARN.
 */
export function importedResources(config: PlayConfig): ExistingResources {
  if (!config.existing) {
    throw new Error(
      `infra/config/play-${config.stage}.json has no 'existing' block, but a stack that ` +
        'imports was built from it. Either the config is wrong or the stack ignored ownership.',
    );
  }
  return config.existing;
}
export function loadConfig(stage: string): PlayConfig {
  const file = configPath(stage);

  if (!fs.existsSync(file)) {
    throw new Error(
      [
        `No infrastructure config for stage '${stage}': ${file} is missing.`,
        '',
        'It is generated from the deployed resources, which is how the stacks learn',
        'the physical names of the tables, the bucket, the distribution and the user',
        'pool they import:',
        '',
        `  npm run import-state --workspace play-infra -- --stage=${stage}`,
      ].join('\n'),
    );
  }

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PlayConfig;

  // Defaults are applied before validation, never after: a config is checked in
  // the shape the stacks will actually read it in, so "ownership is missing"
  // cannot pass here and become a stack-sized surprise later.
  const config: PlayConfig = {
    ...parsed,
    ownership: ownershipOf(parsed),
    cloudFrontPrivateKeyParam:
      parsed.cloudFrontPrivateKeyParam ?? defaultCloudFrontPrivateKeyParam(parsed.stage),
    cloudFrontPublicKeyParam:
      parsed.cloudFrontPublicKeyParam ?? defaultCloudFrontPublicKeyParam(parsed.stage),
    cloudFrontPublicKeyIdParam:
      parsed.cloudFrontPublicKeyIdParam ?? defaultCloudFrontPublicKeyIdParam(parsed.stage),
    cloudFrontKeyVersion: parsed.cloudFrontKeyVersion ?? DEFAULT_CLOUD_FRONT_KEY_VERSION,
    googleClientSecretName:
      parsed.googleClientSecretName ?? googleClientSecretName(parsed.stage),
    stripeSecretName: parsed.stripeSecretName ?? stripeSecretName(parsed.stage),
    stripeWebhookSecretName:
      parsed.stripeWebhookSecretName ?? stripeWebhookSecretName(parsed.stage),
    stripePublishableKeyParam:
      parsed.stripePublishableKeyParam ?? stripePublishableKeyParam(parsed.stage),
  };

  const problems = validate(config);
  if (problems.length > 0) {
    throw new Error(`${file} is incomplete:\n  ${problems.join('\n  ')}`);
  }
  return config;
}

/**
 * The checks that matter, which are the ones whose absence fails late.
 *
 * A missing table name does not fail at synth; it fails as a 500 in the first
 * Lambda that reads that table, after a deploy, in production. A missing
 * distribution domain fails as a broken video URL. Both are cheap to catch
 * here, against a file that is meant to be read by a person anyway.
 *
 * **What is required depends on what is imported.** A physical name is demanded
 * exactly when `ownership` says the corresponding resource is imported — so an
 * environment that owns its tables is not asked for 27 names it does not have,
 * and an environment that imports them cannot leave one out.
 */
function validate(config: PlayConfig): string[] {
  const problems: string[] = [];

  for (const field of ['stage', 'account', 'region'] as const) {
    if (!config[field]) problems.push(`${field} is empty`);
  }

  // It ends up inside a CloudFront key's name and inside a construct id, and a
  // version that is neither is a version that fails this deploy or the next one
  // — with CloudFront's own unhelpful sentence as the error.
  if (config.cloudFrontKeyVersion && !KEY_VERSION.test(config.cloudFrontKeyVersion)) {
    problems.push(
      `cloudFrontKeyVersion ${JSON.stringify(config.cloudFrontKeyVersion)} must be letters, ` +
        'digits and dashes, because it is part of the public key\'s name',
    );
  }

  const ownership = ownershipOf(config);
  const existing = config.existing;

  // A stage either creates its buckets or imports one, and each has its own way
  // of being named. Both at once reads like a decision and behaves like a coin
  // toss, and the loser is a deploy that replaces a bucket full of video.
  if (!ownership.media) {
    for (const field of ['videosBucketName', 'cloudFrontLogsBucketName'] as const) {
      if (config[field]) {
        problems.push(
          `${field} is set, but ownership.media is false — an imported stage names the ` +
            'bucket it uses in existing.videosBucket, and this stage creates neither bucket',
        );
      }
    }
  }

  // The blocks this environment imports, and the fields each one needs. Keyed
  // by block so the error can name which switch to flip instead of listing
  // names a new environment was never going to have.
  const imported: Record<string, readonly (keyof ExistingResources)[]> = {};
  if (!ownership.tables) imported.tables = [];
  if (!ownership.media) {
    imported.media = [
      'videosBucket',
      'cloudFrontDistributionId',
      'cloudFrontDomain',
      'cloudFrontPublicKeyId',
    ];
  }
  if (!ownership.auth) {
    imported.auth = ['userPoolId', 'userPoolClientId', 'userPoolDomain'];
  }

  if (Object.keys(imported).length === 0) return problems;

  if (!existing) {
    problems.push(
      `existing is missing, but ownership imports ${Object.keys(imported).join(', ')} — ` +
        'an environment that imports a resource has to name it',
    );
    return problems;
  }

  if (!ownership.tables && Object.keys(existing.tables ?? {}).length === 0) {
    problems.push('existing.tables is empty');
  }
  for (const [block, fields] of Object.entries(imported)) {
    for (const field of fields) {
      if (!existing[field]) problems.push(`existing.${String(field)} is empty (imported ${block})`);
    }
  }

  return problems;
}
