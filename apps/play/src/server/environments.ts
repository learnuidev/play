import fs from "node:fs";
import path from "node:path";

import type { EnvironmentView } from "@/lib/types";
import { describeStacks, summariseStacks, type CloudStack } from "./aws";
import { defaultRegion, profileSetting, repoPath } from "./repo";

/**
 * An environment, as the console understands one.
 *
 * The unit is a **stage**, which is what the CDK app calls it: `cdk deploy
 * --context stage=dev` deploys `PlayApiStack-dev` and its three siblings, and
 * the stage name is in every Lambda's name, every stack's name and every log
 * group's path.
 *
 * ## Two kinds of environment, and the difference is one switch
 *
 * `ownership` in `infra/config/play-<stage>.json` decides what a stage does with
 * the three stateful groups — the tables, the media (bucket and distribution)
 * and the auth (user pool):
 *
 * | | `tables`/`media`/`auth` | The stage | Its data |
 * | --- | --- | --- | --- |
 * | **New** | `true` | Creates them, named after the stage or by CloudFormation | Its own, empty |
 * | **Migrated** | `false` | Imports them by physical name | Shared with every other migrated stage |
 *
 * **A new environment creates everything.** That is the default the console
 * writes, and it is the one that makes "deploy to a new environment" mean what
 * it sounds like: new tables, a new bucket, a new distribution, a new user pool,
 * all empty, and named so that two environments cannot collide — the tables after
 * the stage, the two S3 buckets by CloudFormation, because a bucket name is
 * unique across every AWS account.
 *
 * `false` is the *migrated* case and exists for exactly one reason: `dev`'s
 * resources predate this CDK app by years and hold the product. An imported
 * resource is unmanaged — CloudFormation will not change it and will not delete
 * it — so a migrated stage can be deployed without any risk to the data. Two
 * migrated stages do point at the same data; that is a property of `dev`, not
 * something a new environment inherits.
 */

export interface StageOwnership {
  tables: boolean;
  media: boolean;
  auth: boolean;
}

/** What a stage that says nothing about ownership does: import, the migrated way. */
export const IMPORT_EVERYTHING: StageOwnership = { tables: false, media: false, auth: false };

export function ownershipOf(config: StageConfig | null): StageOwnership {
  const stated = config?.ownership;
  if (!stated) return IMPORT_EVERYTHING;
  return {
    tables: stated.tables === true,
    media: stated.media === true,
    auth: stated.auth === true,
  };
}

/** True when this environment creates all of its own stateful resources. */
export function ownsEverything(config: StageConfig | null): boolean {
  const ownership = ownershipOf(config);
  return ownership.tables && ownership.media && ownership.auth;
}

export interface StageConfig {
  stage: string;
  account: string;
  region: string;
  /**
   * The resources this stage imports, by physical name.
   *
   * Absent on an environment that owns everything — there is nothing to name.
   */
  existing?: {
    tables?: Record<string, string>;
    videosBucket?: string;
    /**
     * The other half of this environment's media, and only ever named by a
     * config that imports it: a stage that created its own got a generated name
     * instead, which no file holds — `PlayMediaStack-<stage>`'s
     * `VideosBucketName` output is where that one is read from, and the bucket
     * prefix is what makes it readable once the stack is gone.
     */
    cloudFrontLogsBucket?: string;
    userPoolId?: string;
    userPoolClientId?: string;
    userPoolDomain?: string;
    /**
     * The distribution, in the two pieces the console needs to delete one: the
     * id CloudFront calls it by, and the domain it answers on. Both are mirrors
     * of `infra/src/config.ts`'s `ExistingResources`, which is where the
     * imported mode reads them.
     */
    cloudFrontDistributionId?: string;
    cloudFrontDomain?: string;
    cloudFrontPublicKeyId?: string;
    googleSignInEnabled?: boolean;
  };
  mail?: { fromAddress?: string; appBaseUrl?: string; marketplaceBaseUrl?: string };
  auth?: { googleClientId?: string; callbackUrls?: string[]; logoutUrls?: string[] };
  cloudFrontPrivateKeyParam?: string;
  cloudFrontPublicKeyParam?: string;
  /** Where the media stack publishes the id of the key above. Mirrors `infra/src/config.ts`. */
  cloudFrontPublicKeyIdParam?: string;
  /**
   * What to call the two buckets a stage that **creates** its media gets.
   *
   * Absent means CloudFormation names them — which is what a new environment
   * gets, because an S3 name is unique across every AWS account and
   * `play-<stage>-videos` is a name somebody else may already hold. A stage
   * that has buckets freezes their names here (naming one that exists is a
   * *replacement*), and the console reports a fixed name it cannot create
   * before a deploy starts rather than after CloudFormation's early validation.
   *
   * Mirrors `infra/src/config.ts`'s two fields.
   */
  videosBucketName?: string;
  cloudFrontLogsBucketName?: string;
  ownership?: StageOwnership;
  [key: string]: unknown;
}

export function configFile(stage: string): string {
  return repoPath("infra", "config", `play-${stage}.json`);
}

/**
 * Where an environment's CloudFront signing key pair lives.
 *
 * Mirrors `infra/src/config.ts`'s two defaults, and they are **per stage**: the
 * pair signs one environment's URLs, and one environment's handlers should not
 * be able to mint URLs for another's distribution. The names are derived from
 * the stage rather than discovered, which is why a new environment's config can
 * name them before anything exists.
 *
 * A *migrated* stage names its own, and has to: `dev` imports the distribution
 * the legacy key group already gates, so its private half is the shared
 * `/play/cloudfront/private-key` — the pair that distribution was created
 * against. Nothing here decides that; the config says it.
 */
export function defaultCloudFrontPrivateKeyParam(stage: string): string {
  return `/play/${stage}/cloudfront/private-key`;
}

export function defaultCloudFrontPublicKeyParam(stage: string): string {
  return `/play/${stage}/cloudfront/public-key`;
}

/**
 * Where the id of the key that public half belongs to is published.
 *
 * Mirrors `infra/src/config.ts`'s third default, and the console needs it for
 * one reason: a delete has to take the parameter with it, and a name nobody
 * wrote down is a name nobody can delete.
 */
export function defaultCloudFrontPublicKeyIdParam(stage: string): string {
  return `/play/${stage}/cloudfront/public-key-id`;
}

export function readConfig(stage: string): StageConfig | null {
  try {
    const text = fs.readFileSync(configFile(stage), "utf8");
    const parsed = JSON.parse(text) as StageConfig;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Writes a config file, creating `infra/config` if it is not there. */
export function writeConfig(config: StageConfig): string {
  const file = configFile(config.stage);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

/**
 * The stage a **new** environment's product settings are copied from.
 *
 * `dev` first — it is the stage that exists in every checkout — then any other
 * stage whose file is complete. A stage in a different account is refused rather
 * than noticed later, because the account is what the borrowed ARNs are built
 * from.
 *
 * What is copied is deliberately only the settings that describe *the product*
 * rather than this environment: the mail addresses, the Google client id, the
 * callback URLs and the CloudFront key parameter names. The data — the physical
 * table names, the bucket, the pool — never is, and that is the difference
 * between a new environment and a second front door to `dev`'s database.
 */
export function pickSeedStage(stage: string): string | null {
  const candidates = listStages().filter((candidate) => candidate !== stage);
  const ordered = candidates.sort((a, b) => (a === "dev" ? -1 : b === "dev" ? 1 : 0));
  for (const candidate of ordered) {
    const loaded = readConfig(candidate);
    if (loaded && configProblems(loaded).length === 0) return candidate;
  }
  return null;
}

export interface NewStageInput {
  /** The account the console is acting as, which is what the deploy will use. */
  account?: string | null;
  region?: string | null;
  /** What a person supplied, when the console has asked them. Beats the seed's copy. */
  auth?: StageConfig["auth"];
  mail?: StageConfig["mail"];
}

/**
 * The config file a **new environment** gets.
 *
 * `ownership` is all three `true`, which is the whole of the difference between
 * creating the tables, the bucket, the distribution and the pool and importing
 * somebody else's — and there is deliberately no `existing` block, because there
 * is nothing to name. Seeding a new stage with `dev`'s file would copy
 * `ownership: false` and dev's 27 physical table names along with it: a stage
 * that reads like a new environment and behaves like a second front door to the
 * same database.
 *
 * The product settings — mail, the Google client, the callback URLs, the key
 * parameter names — *are* carried over, because a stage that invented its own
 * would be a stage whose Google sign-in does not work.
 */
export function newStageConfig(
  stage: string,
  seed: StageConfig | null,
  input: NewStageInput = {},
): StageConfig {
  const auth = input.auth ?? seed?.auth;
  const mail = input.mail ?? seed?.mail;
  return {
    stage,
    account: input.account ?? seed?.account ?? "",
    region: input.region ?? seed?.region ?? "us-east-1",
    ownership: { tables: true, media: true, auth: true },
    ...(mail ? { mail } : {}),
    ...(auth ? { auth } : {}),
    // **Not the seed's.** Those are the *seed's* key parameters — for `dev`, the
    // shared pair its imported distribution was created against — and a new
    // environment signs with its own.
    cloudFrontPrivateKeyParam: defaultCloudFrontPrivateKeyParam(stage),
    cloudFrontPublicKeyParam: defaultCloudFrontPublicKeyParam(stage),
  };
}

/**
 * Why a config file is not usable, or an empty list when it is.
 *
 * The same checks `infra/src/config.ts` makes at synth, said here so the deploy
 * console can fail on step three instead of step eight — and said in terms of
 * what is missing rather than what threw.
 *
 * A physical name is required exactly when `ownership` says that group is
 * imported. An environment that owns its tables is not asked for 27 names it was
 * never going to have; an environment that imports them cannot leave one out.
 */
export function configProblems(config: StageConfig | null): string[] {
  if (!config) return ["the file does not exist, or is not JSON"];
  const problems: string[] = [];
  for (const field of ["stage", "account", "region"] as const) {
    if (!config[field]) problems.push(`${field} is empty`);
  }

  const ownership = ownershipOf(config);
  const imported: Record<string, readonly string[]> = {};
  if (!ownership.tables) imported.tables = [];
  if (!ownership.media) imported.media = ["videosBucket", "cloudFrontDomain"];
  if (!ownership.auth) {
    imported.auth = ["userPoolId", "userPoolClientId", "userPoolDomain"];
  }
  if (Object.keys(imported).length === 0) return problems;

  if (!config.existing) {
    problems.push(
      `ownership imports ${Object.keys(imported).join(", ")}, so 'existing' is required — ` +
        "an environment that imports a resource has to name it",
    );
    return problems;
  }

  if (!ownership.tables && Object.keys(config.existing.tables ?? {}).length === 0) {
    problems.push("existing.tables is empty");
  }
  for (const [block, fields] of Object.entries(imported)) {
    for (const field of fields) {
      if (!(config.existing as Record<string, unknown>)[field]) {
        problems.push(`existing.${field} is empty (imported ${block})`);
      }
    }
  }
  return problems;
}

/**
 * Every stage this repository knows about.
 *
 * The config directory is the list, because a stage without a config file
 * cannot be deployed — `loadConfig` throws at synth. `dev` is added whether or
 * not the file is there, since it is the stage a fresh checkout means.
 */
export function listStages(): string[] {
  const dir = repoPath("infra", "config");
  const stages = new Set<string>(["dev"]);
  try {
    for (const entry of fs.readdirSync(dir)) {
      const match = /^play-(.+)\.json$/.exec(entry);
      if (match) stages.add(match[1]);
    }
  } catch {
    // No config directory: `dev` is still the right guess.
  }
  return [...stages].sort((a, b) => (a === "dev" ? -1 : b === "dev" ? 1 : a.localeCompare(b)));
}

/* ------------------------------------------------------------------ *
 * The values an app needs, read out of two stacks
 * ------------------------------------------------------------------ */

export interface StageOutputs {
  apiUrl: string | null;
  userPoolId: string | null;
  userPoolClientId: string | null;
  cognitoDomain: string | null;
  googleAuthEnabled: boolean;
  /** The environment variables a frontend is handed, ready to spread. */
  env: Record<string, string>;
}

/**
 * Reads `PlayApiStack-<stage>` and `PlayAuthStack-<stage>` and flattens their
 * outputs into what an app's `.env.local` holds.
 *
 * This is `scripts/get-env.mjs`'s two-stack rule applied in memory: the API URL
 * comes from the API stack, the pool, its client and the Hosted UI domain from
 * the auth stack, and everything else an app wants is derived from the port it
 * serves on rather than from the deployment.
 */
export async function stageOutputs(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<StageOutputs> {
  const [api, auth] = await describeStacks(
    [`PlayApiStack-${stage}`, `PlayAuthStack-${stage}`],
    ctx,
  );

  const apiUrl = api?.outputs.ApiUrl ?? null;
  const userPoolId = auth?.outputs.CognitoUserPoolId ?? null;
  const userPoolClientId = auth?.outputs.CognitoUserPoolClientId ?? null;
  const cognitoDomain = auth?.outputs.CognitoDomain ?? null;
  const googleAuthEnabled = auth?.outputs.GoogleAuthEnabled === "true";

  const env: Record<string, string> = {};
  if (apiUrl) env.NEXT_PUBLIC_API_URL = apiUrl;
  if (userPoolId) env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = userPoolId;
  if (userPoolClientId) env.NEXT_PUBLIC_COGNITO_CLIENT_ID = userPoolClientId;
  if (cognitoDomain) env.NEXT_PUBLIC_COGNITO_DOMAIN = cognitoDomain;
  if (auth?.outputs.GoogleAuthEnabled) {
    env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = String(googleAuthEnabled);
  }

  return {
    apiUrl,
    userPoolId,
    userPoolClientId,
    cognitoDomain,
    googleAuthEnabled,
    env,
  };
}

/* ------------------------------------------------------------------ *
 * The view the UI draws
 * ------------------------------------------------------------------ */

/**
 * One environment, built from the snapshot the state route already has.
 *
 * The outputs come out of `describe-stacks`' one call rather than a pair of
 * calls per stage: the rail draws a row per environment, and a second round trip
 * per row is the difference between a page that settles and one that trickles.
 * The region is the config's — a stage in another region is a stage whose stacks
 * are not in this snapshot, which is what "not deployed" correctly means here.
 */
export function environmentView(
  stage: string,
  all: CloudStack[],
  ctx: { profile?: string; region?: string } = {},
): EnvironmentView {
  const config = readConfig(stage);
  const region = config?.region ?? ctx.region ?? defaultRegion();
  const { root, deployed, partial } = summariseStacks(stage, all);

  const api = all.find((stack) => stack.name === `PlayApiStack-${stage}`);
  const auth = all.find((stack) => stack.name === `PlayAuthStack-${stage}`);
  const outputs: Record<string, string> = {
    ...(api?.outputs ?? {}),
    ...(auth?.outputs ?? {}),
  };

  return {
    stage,
    configPath: path.relative(repoPath(), configFile(stage)),
    hasConfig: config !== null && configProblems(config).length === 0,
    account: config?.account ?? null,
    region,
    tables: Object.keys(config?.existing?.tables ?? {}).length,
    ownership: config?.ownership ?? null,
    ownsEverything: ownsEverything(config),
    stacks: root,
    deployed,
    partial,
    apiUrl: outputs.ApiUrl ?? null,
    userPoolId: outputs.CognitoUserPoolId ?? null,
    userPoolClientId: outputs.CognitoUserPoolClientId ?? null,
    cognitoDomain: outputs.CognitoDomain ?? null,
    googleAuthEnabled: outputs.GoogleAuthEnabled === "true",
  };
}

export function consoleDefaults() {
  const { profile, source } = profileSetting();
  return { profile, profileSource: source, region: defaultRegion() };
}
