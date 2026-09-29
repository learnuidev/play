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
 * | **New** | `true` | Creates them, named `play-<stage>-*` | Its own, empty |
 * | **Migrated** | `false` | Imports them by physical name | Shared with every other migrated stage |
 *
 * **A new environment creates everything.** That is the default the console
 * writes, and it is the one that makes "deploy to a new environment" mean what
 * it sounds like: new tables, a new bucket, a new distribution, a new user pool,
 * all empty, named after the stage.
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
    userPoolId?: string;
    userPoolClientId?: string;
    userPoolDomain?: string;
    cloudFrontDomain?: string;
    googleSignInEnabled?: boolean;
  };
  mail?: { fromAddress?: string; appBaseUrl?: string; marketplaceBaseUrl?: string };
  auth?: { googleClientId?: string; callbackUrls?: string[]; logoutUrls?: string[] };
  cloudFrontPrivateKeyParam?: string;
  cloudFrontPublicKeyParam?: string;
  ownership?: StageOwnership;
  [key: string]: unknown;
}

export function configFile(stage: string): string {
  return repoPath("infra", "config", `play-${stage}.json`);
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
