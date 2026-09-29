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
  existing: ExistingResources;
  mail: MailSettings;
  auth: AuthSettings;
  /** The *name* of the CloudFront signing key parameter. Never the key. */
  cloudFrontPrivateKeyParam: string;
  ownership: Ownership;
}

/** Where `import-state.mjs` writes, and where this reads. */
export function configPath(stage: string): string {
  return path.join(CONFIG_DIR, `play-${stage}.json`);
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

  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as PlayConfig;
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
 */
function validate(config: PlayConfig): string[] {
  const problems: string[] = [];

  for (const field of ['stage', 'account', 'region'] as const) {
    if (!config[field]) problems.push(`${field} is empty`);
  }
  if (!config.existing) {
    problems.push('existing is missing');
    return problems;
  }
  for (const field of [
    'videosBucket',
    'cloudFrontDistributionId',
    'cloudFrontDomain',
    'cloudFrontPublicKeyId',
    'userPoolId',
    'userPoolClientId',
    'userPoolDomain',
  ] as const) {
    if (!config.existing[field]) problems.push(`existing.${field} is empty`);
  }
  if (Object.keys(config.existing.tables ?? {}).length === 0) {
    problems.push('existing.tables is empty');
  }

  return problems;
}
