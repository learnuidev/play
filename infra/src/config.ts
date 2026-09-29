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
  /** The Secrets Manager secret a created pool reads the Google client secret from. */
  googleClientSecretName: string;
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
    googleClientSecretName:
      parsed.googleClientSecretName ?? googleClientSecretName(parsed.stage),
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
