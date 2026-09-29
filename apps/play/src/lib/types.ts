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
 * Checklist tab shows them so nobody has to derive a Cognito domain by hand and
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
  /**
   * False until the file is written — which is the state a **new** environment
   * is in. Its settings are then a draft: what the deploy *would* configure,
   * carried over from a stage that already has the product's values.
   */
  hasConfig: boolean;
  /** Which environment a draft's product settings were copied from. */
  seededFrom: string | null;
  account: string | null;
  region: string | null;
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

/**
 * What a save wrote, so the page can say it rather than guess.
 *
 * A save is up to three writes with three destinations — the committed config
 * file, Secrets Manager, and the signing key's parameters — and "Saved" is not
 * an honest summary of all three.
 */
export interface SettingsWriteView {
  configPath: string;
  /** The file was created by this save rather than updated. */
  created: boolean;
  secretWritten: boolean;
  /** What the signing-key check found. Null when this environment imports its media. */
  signingKeyNote: string | null;
}

/**
 * The CloudFront URL-signing key pair, as the console can see it.
 *
 * Neither half is ever part of this: the public one is read by the media stack
 * at deploy time, the private one by the handlers at request time, and all this
 * says is whether they are there.
 */
export interface SigningKeyView {
  /** Holds the private half, as a SecureString the handlers read by name. */
  privateParam: string;
  /** Holds the public half, which the distribution's public key is created from. */
  publicParam: string;
  /** Where the two names came from: this environment's config, or the defaults. */
  source: "config" | "default";
  /**
   * Whether these are this environment's *own* parameters. False only where a
   * config names the shared pair — `dev`, whose distribution imports the key
   * group that pair gates, and stages seeded before the pair was per
   * environment.
   */
  own: boolean;
  privateExists: boolean;
  publicExists: boolean;
  /** Both halves are in SSM, so a deploy can build a distribution that signs URLs. */
  ready: boolean;
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
 * Backends: what a deploy reads and produces, and what it did
 * ------------------------------------------------------------------ */

export interface BackendFunctionView {
  /** The deployed Lambda name: `play-<stage>-<key>`. */
  name: string;
  key: string;
  logGroup: string;
  runtime: string | null;
  modified: string | null;
  /** Never answers a request, so nowhere else to say anything. */
  eventDriven: boolean;
}

export interface LogEventView {
  at: number;
  stream: string;
  message: string;
}

export interface BackendLogs {
  function: string;
  logGroup: string;
  events: LogEventView[];
  /** Why the list is empty, when it is — "nothing ran" beats a blank panel. */
  note: string | null;
}

/**
 * One row of an environment's variables.
 *
 * The same shape for a **backend's inputs** (what a deploy reads: the Google
 * client, the callback URLs, the mail sender), its **outputs** (what it
 * produces: the API URL, the pool, its client and domain), and a **frontend's**
 * variables, because they are all "a name, a value, and where it comes from" —
 * and the interesting part of every one of them is that last clause.
 */
export interface EnvRow {
  key: string;
  /** Null when the value is a secret, or when there is nothing to show yet. */
  value: string | null;
  /** Where it comes from, in the environment's own words. */
  source: string;
  /** A credential: reported as set or not, never echoed. */
  secret?: boolean;
  /** Written by the Settings form rather than by a deploy. */
  editable?: boolean;
  /** Which surface reads it — how a value here reaches a browser. */
  usedBy?: string[];
}

export interface BackendEnvView {
  stage: string;
  inputs: EnvRow[];
  outputs: EnvRow[];
}

export interface FrontendEnvView {
  app: AppKey;
  stage: string;
  rows: EnvRow[];
  /** The app is running locally against *this* stage right now. */
  running: boolean;
}

/** A CloudFormation stack event: what actually happened, and when. */
export interface DeploymentEventView {
  at: number;
  stack: string;
  status: string;
  reason: string | null;
  resource: string | null;
}

export interface DeploymentHistoryView {
  stage: string;
  events: DeploymentEventView[];
  note: string | null;
}

/* ------------------------------------------------------------------ *
 * Integrations
 * ------------------------------------------------------------------ */

export interface VercelDeploymentView {
  id: string;
  url: string | null;
  state: string;
  target: string | null;
  createdAt: number | null;
  branch: string | null;
  commitMessage: string | null;
  commitSha: string | null;
}

export interface VercelEnvVar {
  key: string;
  /** Null for a sensitive variable — Vercel does not return those. */
  value: string | null;
  targets: string[];
}

export interface VercelProjectView {
  app: AppKey;
  /** The project name `docs/deploy.md` suggests. */
  name: string;
  /** What Vercel says the project builds, when it has been found. */
  rootDirectory: string | null;
  /** The custom domain the project serves, if it has been added. */
  domain: string;
  /** False when the account has no project by that name — reported, not guessed. */
  found: boolean;
  id: string | null;
  prodUrl: string | null;
  deployments: VercelDeploymentView[];
  env: VercelEnvVar[];
  error: string | null;
}

/**
 * Where the console's Vercel token came from.
 *
 * `cli` is the `vercel` CLI's own session — what the Connect button creates —
 * and `file` is the token the form writes into `apps/play/.env.local`.
 */
export type VercelTokenSource = "environment" | "cli" | "file";

/** What the Vercel CLI looks like from here. */
export interface VercelCliView {
  installed: boolean;
  /** The binary that would be run, when there is one. */
  path: string | null;
  /** Unix seconds. The CLI's own store says when its token lapses. */
  tokenExpiresAt: number | null;
}

export type VercelLoginStatus = "idle" | "running" | "done" | "failed" | "cancelled";

/** Which command the sign-in is on: the install, or the login itself. */
export type VercelLoginStep = "install" | "login";

export interface VercelLoginView {
  status: VercelLoginStatus;
  step: VercelLoginStep | null;
  startedAt: number | null;
  finishedAt: number | null;
  /**
   * The device page the CLI printed, absolute and ready to open.
   *
   * Surfaced rather than left in the transcript because it is the one thing the
   * person has to *do*: the CLI is polling until somebody approves the code.
   */
  url: string | null;
  error: string | null;
  lineCount: number;
}

export type VercelLoginEvent =
  | { type: "login"; login: VercelLoginView; at: number }
  | { type: "log"; line: LogLine }
  | { type: "end"; login: VercelLoginView; at: number };

export interface VercelOverview {
  connected: boolean;
  tokenSource: VercelTokenSource | null;
  cli: VercelCliView;
  /** The sign-in run, so a page reloaded mid-flow rejoins it. */
  login: VercelLoginView;
  projects: VercelProjectView[];
  error: string | null;
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
