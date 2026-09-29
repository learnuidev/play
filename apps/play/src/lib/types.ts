/**
 * The shapes the console's server and its browser agree on.
 *
 * One file, imported from both sides, for the same reason `@play/types` exists:
 * a field added to an API response is added in one place and both halves see
 * it. Everything here is JSON — it crosses a `fetch`, and anything that is not
 * (a `ChildProcess`, a timer) stays on the server.
 */

export type LogStream = "out" | "err" | "note";

export interface LogLine {
  /** Monotonic within a run, so a client can stitch a stream back together. */
  seq: number;
  at: number;
  stream: LogStream;
  text: string;
}

export type StepStatus =
  | "pending"
  | "running"
  /** The step did work, and it worked. */
  | "passed"
  /** The step was already satisfied — the check found nothing to do. */
  | "skipped"
  /** Optional, attempted, did not work. The run carries on. */
  | "warned"
  /**
   * Reported, and deliberately not done.
   *
   * A step whose right answer depends on something the console cannot know —
   * which stage owns the shared user pool's pre sign-up trigger, for instance —
   * ends here rather than being applied on somebody's behalf. It is finished, it
   * did not fail, and it is the one state that is asking for a person.
   */
  | "manual"
  | "failed"
  /** Never reached: an earlier step stopped the run. */
  | "halted";

export interface StepView {
  id: string;
  /** One short sentence, sentence case: what this step is. */
  title: string;
  /** Why it exists, in the repository's own words. Shown when a row is open. */
  detail: string;
  /** Optional steps can fail without failing the run. */
  optional: boolean;
  /** What the chip says when the check found it already done. */
  satisfiedLabel: string;
  status: StepStatus;
  /** What the check found, or what the work did. One line. */
  note: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Lines the transcript dropped to stay inside its cap. */
  droppedLines: number;
}

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface StackSummary {
  name: string;
  status: string;
  /** `*_COMPLETE`, which is not the same as `*_COMPLETE` for an update in
   *  progress — but CloudFormation has no such status. See `healthy`. */
  healthy: boolean;
  /** The stacks that are ours, as opposed to the nested ones CDK names. */
  nested: boolean;
}

export interface RunResult {
  apiUrl: string | null;
  userPoolId: string | null;
  userPoolClientId: string | null;
  cognitoDomain: string | null;
  googleAuthEnabled: boolean;
  stacks: StackSummary[];
}

export interface RunView {
  id: string;
  stage: string;
  profile: string;
  region: string;
  account: string | null;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  steps: StepView[];
  result: RunResult | null;
  /** Why the run stopped, when it did. */
  error: string | null;
}

/* ------------------------------------------------------------------ *
 * The three frontends
 * ------------------------------------------------------------------ */

export type AppKey = "studio" | "marketplace" | "demo";

export type ServiceStatus = "stopped" | "starting" | "running" | "failed";

export interface ServiceView {
  app: AppKey;
  name: string;
  /** One sentence: what this app is, in the workspace's own words. */
  blurb: string;
  port: number;
  url: string;
  /**
   * The environment the process was started with. `null` means "whatever its
   * `.env.local` says" — which is how the apps run when nobody has chosen.
   */
  stage: string | null;
  status: ServiceStatus;
  pid: number | null;
  startedAt: number | null;
  /** When the dev server printed its Local URL. */
  readyAt: number | null;
  exitCode: number | null;
  error: string | null;
  /** The API URL the process was handed, so the card can show what it points at. */
  apiUrl: string | null;
  lineCount: number;
  /**
   * Started by an earlier console session and picked up again by this one.
   *
   * The dev server is fine — it is the console that went away — but its output
   * went with the pipes, so the card says as much rather than showing an empty
   * transcript as if the app had nothing to say.
   */
  adopted: boolean;
}

/* ------------------------------------------------------------------ *
 * Environments, and who we are
 * ------------------------------------------------------------------ */

export interface EnvironmentView {
  stage: string;
  configPath: string;
  hasConfig: boolean;
  account: string | null;
  region: string | null;
  /** Tables this environment *imports*. Zero when it creates its own. */
  tables: number;
  ownership: { tables: boolean; media: boolean; auth: boolean } | null;
  /** True when this environment creates the tables, media and pool itself. */
  ownsEverything: boolean;
  stacks: StackSummary[];
  /** Every one of the four root stacks is `*_COMPLETE`. */
  deployed: boolean;
  /** Some are there, some are not — the state a failed first deploy leaves. */
  partial: boolean;
  apiUrl: string | null;
  userPoolId: string | null;
  userPoolClientId: string | null;
  cognitoDomain: string | null;
  googleAuthEnabled: boolean;
}

export interface Identity {
  account: string;
  arn: string;
  userId: string;
}

export interface ConsoleState {
  repoRoot: string;
  profile: string;
  profileSource: "AWS_PROFILE" | "scripts/api-config.env";
  region: string;
  identity: Identity | null;
  /** Why the identity could not be read — credentials, usually a stale SSO session. */
  identityError: string | null;
  environments: EnvironmentView[];
  /** Stages that could be deployed but have no config file yet. */
  suggestions: string[];
}

/* ------------------------------------------------------------------ *
 * The settings a person supplies
 * ------------------------------------------------------------------ */

/**
 * The half of a federated sign-in that lives in the Google Cloud console.
 *
 * These are not inputs — they are *outputs*, read off the deployment, and the
 * Settings view shows them so nobody has to derive a Cognito domain by hand and
 * get `redirect_uri_mismatch` for it.
 */
export interface GoogleOAuthValues {
  cognitoDomain: string | null;
  /** Authorized JavaScript origins. */
  javaScriptOrigin: string | null;
  /** Authorized redirect URIs — Cognito's `/oauth2/idpresponse`. */
  redirectUri: string | null;
}

/**
 * What an environment is configured with, rather than what it is discovered to
 * be. The secret's *value* is never part of this — only whether one is stored.
 */
export interface EnvironmentSettings {
  stage: string;
  configPath: string;
  ownership: { tables: boolean; media: boolean; auth: boolean };
  /** True when this environment creates its pool, so a provider and secret are needed. */
  needsGoogleSecret: boolean;
  googleClientSecretName: string;
  googleClientSecretSet: boolean;
  auth: {
    googleClientId: string;
    callbackUrls: string[];
    logoutUrls: string[];
  };
  mail: {
    fromAddress: string;
    appBaseUrl: string;
    marketplaceBaseUrl: string;
  };
  /** What to paste into the Google Cloud console. */
  oauth: GoogleOAuthValues;
}

export interface EnvironmentSettingsInput {
  auth: {
    googleClientId: string;
    callbackUrls: string[];
    logoutUrls: string[];
  };
  mail: {
    fromAddress: string;
    appBaseUrl: string;
    marketplaceBaseUrl: string;
  };
  /**
   * Write-only. Empty or absent leaves whatever is stored alone, so saving the
   * form without retyping the secret does not clear it.
   */
  googleClientSecret?: string;
}

/* ------------------------------------------------------------------ *
 * What crosses the wire
 * ------------------------------------------------------------------ */

export type DeployEvent =
  | { type: "run"; run: RunView; at: number }
  | { type: "step"; step: StepView; at: number }
  | { type: "log"; stepId: string; line: LogLine }
  | { type: "end"; run: RunView; at: number };

export type ServiceEvent =
  | { type: "services"; services: ServiceView[]; at: number }
  | { type: "log"; app: AppKey; line: LogLine }
  | { type: "status"; service: ServiceView; at: number };
