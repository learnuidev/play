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
 * group's path. A second stage is a second API, a second set of media roles and
 * a second pre sign-up trigger — deployed from the same repository, into the
 * same account, over the *same imported data*.
 *
 * That last clause is the one worth being loud about, because it is the thing
 * that is surprising about this backend and the thing that makes a new
 * environment cheap:
 *
 * > The tables, the videos bucket, the CloudFront distribution and the Cognito
 * > user pool are imported. An imported resource is unmanaged — CloudFormation
 * > will not change it and will not delete it. So deploying a stage creates the
 * > API and nothing that holds data, and every stage points at the same data.
 *
 * A stage that should own its data is `ownership.tables` in the config file,
 * which `docs/migration.md` phase E says to do when a property actually needs
 * changing. The console shows those three switches as they are, rather than
 * offering to flip them.
 */

export interface StageConfig {
  stage: string;
  account: string;
  region: string;
  existing: {
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
  ownership?: { tables: boolean; media: boolean; auth: boolean };
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
 * Why a config file is not usable, or null when it is.
 *
 * The same checks `infra/src/config.ts` makes at synth, said here so the deploy
 * console can fail on step three instead of step eight — and said in terms of
 * what is missing rather than what threw.
 */
export function configProblems(config: StageConfig | null): string[] {
  if (!config) return ["the file does not exist, or is not JSON"];
  const problems: string[] = [];
  for (const field of ["stage", "account", "region"] as const) {
    if (!config[field]) problems.push(`${field} is empty`);
  }
  if (!config.existing) {
    problems.push("existing is missing");
    return problems;
  }
  for (const field of [
    "videosBucket",
    "userPoolId",
    "userPoolClientId",
    "userPoolDomain",
  ] as const) {
    if (!config.existing[field]) problems.push(`existing.${field} is empty`);
  }
  if (Object.keys(config.existing.tables ?? {}).length === 0) {
    problems.push("existing.tables is empty");
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
