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

/**
 * What a backend run does to an environment.
 *
 * One engine, two directions: a **deploy** takes a stage from nothing to four
 * complete stacks, and a **destroy** takes it back to none — the five stacks and
 * the config file, and never the data (every stateful resource here is
 * `RemovalPolicy.RETAIN`).
 *
 * It is on the run rather than inferred from the steps because the whole console
 * reads it: the chip on a row, the line under a name, what the page calls the
 * thing that is going. A row that said "deploying" over a destroy would be
 * telling somebody the opposite of what is happening to their environment.
 */
export type RunAction = "deploy" | "destroy";

/**
 * What a run is about.
 *
 * Two runs, one engine: a **backend** run takes an environment from nothing to
 * four complete CloudFormation stacks, and a **frontend** run takes one app from
 * "the variables on the Vercel project point somewhere else" to a deployment
 * serving it on its own domain. They share a checklist, a transcript and a
 * cancel button, and they are told apart by this — which is what the page reads
 * to know whether to draw stacks or a deployment beside the result.
 */
export type RunKind = "backend" | "frontend";

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
  kind: RunKind;
  /** Which way this run goes: building the environment, or taking it away. */
  action: RunAction;
  /**
   * The backend environment, in both cases — a frontend run deploys *against*
   * one, because the values it writes to Vercel are that environment's outputs.
   */
  stage: string;
  profile: string;
  region: string;
  account: string | null;
  /**
   * A frontend run only: which app, for which Vercel environment, on what
   * domain. Kept on the view rather than in the page's state so a reload finds
   * the run it left and can still say what it was doing.
   */
  vercel: VercelDeployTarget | null;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  steps: StepView[];
  /** A backend run's root stacks, and the outputs an app needs. */
  result: RunResult | null;
  /**
   * A destroy run's account of what it left behind, one thing per line.
   *
   * The result of deleting an environment is not a URL: it is a list of things
   * still in AWS and what they cost the next deploy of the same name. Written by
   * the run's last step out of what it read, and shown when the run is over.
   */
  report: string[] | null;
  /** A frontend run's own deployment — the one it created, not the latest one. */
  deployment: VercelDeployResult | null;
  /** Why the run stopped, when it did. */
  error: string | null;
}

/**
 * A run as the *list* of environments needs it: what it is about, and how far it
 * has got.
 *
 * Deliberately not a `RunView`. Most of a run is text — each of the fourteen
 * steps carries the paragraph explaining why it exists, which is the bulk of the
 * payload and the reason the deploy page is worth reading — and the list asks
 * every three seconds, for every environment at once, to draw a chip and a step
 * number. So it reads this instead: the same facts, without the prose.
 */
export interface RunSummary {
  id: string;
  /** The environment it is about. */
  stage: string;
  /** Which way it goes — so a row can say "deleting" and not "deploying". */
  action: RunAction;
  status: RunStatus;
  startedAt: number;
  /** Which step it is on, and what that step is called. */
  steps: Array<{ id: string; title: string; status: StepStatus }>;
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
  /** Every one of the root stacks is `*_COMPLETE`. */
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
 * The Stripe credentials a deployment takes money with, as the console can see
 * them.
 *
 * Two of the three values are credentials and are reported as set or not, never
 * echoed — the same rule the Google client secret has, and for the same reason.
 * The third is the publishable key, which is *not* a secret: it is served to
 * browsers, so it is read back and shown like any other setting.
 */
export interface StripeSettingsView {
  /** Secrets Manager secret holding the API key, `sk_…`. Never the value. */
  secretName: string;
  secretKeySet: boolean;
  /** Secrets Manager secret holding the endpoint's signing secret, `whsec_…`. */
  webhookSecretName: string;
  webhookSigningSecretSet: boolean;
  /** SSM parameter holding the publishable key, `pk_…`. */
  publishableKeyParam: string;
  /** Not a secret: this is what a marketplace page loads Stripe.js with. */
  publishableKey: string | null;
  /**
   * Where Stripe has to be pointed — `PlayPaymentStack-<stage>`'s function URL.
   *
   * Null until the payment stack has been deployed, which is the state a new
   * environment is in: the URL does not exist until something creates it, and
   * the row says as much rather than showing an empty box.
   */
  webhookUrl: string | null;
  /** The events the endpoint does something about. See `STRIPE_EVENTS`. */
  events: string[];
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
  /** What to paste into the Stripe dashboard, and what is already stored. */
  stripe: StripeSettingsView;
}

/**
 * What a save wrote, so the page can say it rather than guess.
 *
 * A save is up to four writes with four destinations — the committed config
 * file, Secrets Manager, the signing key's parameters, and the live app client —
 * and "Saved" is not an honest summary of all four.
 */
export interface SettingsWriteView {
  configPath: string;
  /** The file was created by this save rather than updated. */
  created: boolean;
  secretWritten: boolean;
  /** What the signing-key check found. Null when this environment imports its media. */
  signingKeyNote: string | null;
  /** What happened to the live app client, which is the other half of a URL save. */
  authUrls: AuthUrlsWriteView;
  /**
   * What this save did about the Stripe credentials.
   *
   * Null when it was not given any — a save that only changed the mail sender
   * has nothing to say about Stripe, and a summary that reported "no Stripe key
   * written" on every save would be noise on the line beside the button.
   */
  stripe: StripeWriteView | null;
}

/** Which of the three Stripe values a save replaced. */
export interface StripeWriteView {
  /** The API key is in Secrets Manager now. */
  secretKeyWritten: boolean;
  /** The endpoint's signing secret is in Secrets Manager now. */
  webhookSigningSecretWritten: boolean;
  /** The publishable key is in SSM now. */
  publishableKeyWritten: boolean;
}

/**
 * Whether the callback and logout URLs that were just saved reached the pool
 * that is running.
 *
 * The config file is what a **deploy** reads, and a stage that imports its pool
 * has no deploy that can change the URL lists Cognito accepts — an imported
 * resource is unmanaged. So the save runs `set-auth-urls.mjs` as well, and this
 * is what it found rather than what was assumed: a stage whose pool does not
 * exist yet is a sentence here, not a failed save.
 */
export interface AuthUrlsWriteView {
  /** Cognito was reached, and now holds the lists that were just saved. */
  applied: boolean;
  /** One sentence: what happened, or why it did not. */
  note: string;
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
  /**
   * True when this environment **imports** its distribution.
   *
   * It changes which half matters: a stage that creates a distribution is built
   * from the public parameter, so both halves have to be there, while a stage
   * that imports one already has its public side — `cloudFrontPublicKeyId`, in
   * its config — and only ever needs the private half, to sign with.
   */
  importedMedia: boolean;
  /** Everything this environment needs to sign URLs is in SSM. */
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
  /**
   * The Stripe credentials, each write-only on the same terms: an absent field
   * leaves what is stored alone. The publishable key is the exception — it is
   * read back and prefilled, so an empty one *clears* it, because that is what a
   * person emptying the box meant.
   */
  stripe?: {
    secretKey?: string;
    webhookSigningSecret?: string;
    publishableKey?: string;
  };
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
  /**
   * The domains pointing at this deployment.
   *
   * Read rather than assumed because attaching a domain is one of the things a
   * frontend deploy does, and "did it take" is a question only Vercel can
   * answer — the console's own record of what it asked for is not evidence.
   */
  aliases: string[];
}

export interface VercelEnvVar {
  key: string;
  /**
   * Null when Vercel will not return the value: `sensitive` ones never come
   * back, and `encrypted` ones come back as an envelope rather than a value.
   */
  value: string | null;
  /** `plain`, `encrypted`, `sensitive` or `system`. */
  type: string;
  targets: string[];
}

/**
 * The three environments a Vercel project builds for.
 *
 * Not the same thing as a Play environment, and the two are easy to confuse:
 * `target` is *where in Vercel* a value lands, and a Play stage is *which
 * backend* the value points at. Writing `staging`'s API URL to the `preview`
 * target is the whole point of the distinction.
 */
export type VercelTarget = "production" | "preview" | "development";

/** A domain on a project, and whether it is actually serving. */
export interface VercelDomainView {
  name: string;
  /** Vercel has seen the DNS record and the domain answers for the project. */
  verified: boolean;
  /** The branch the domain is linked to. `null` is production. */
  gitBranch: string | null;
  /** What Vercel wants in DNS, when it is not verified yet. */
  records: string[];
}

/**
 * What a frontend deployment is: one app, against one environment, in one of
 * Vercel's three targets, on one domain.
 *
 * All four are asked for because none of them can be derived from the others —
 * and the pair that is easiest to conflate is `stage` and `target`, which is
 * exactly why the form asks for both.
 */
export interface VercelDeployTarget {
  app: AppKey;
  stage: string;
  target: VercelTarget;
  /** The custom domain to put this deployment on. Optional. */
  domain: string | null;
}

/** One row of what the run wrote to the project, and what it did about it. */
export interface VercelVariableWrite {
  key: string;
  value: string;
  target: VercelTarget;
  /** `created`, `updated`, or `narrowed` when an existing record spanned targets. */
  action: "created" | "updated" | "unchanged" | "narrowed";
}

/**
 * Everything a frontend run produced.
 *
 * Three things rather than one, because they are three different claims and
 * only the first is a deployment: the variables were *written*, the domain was
 * *attached*, and the build is *the one this run made*. Reporting them as a
 * deployment URL alone would hide which of the three actually happened.
 */
export interface VercelDeployResult {
  deployment: VercelDeploymentView | null;
  variables: VercelVariableWrite[];
  /** The domain, as Vercel reports it after the write — not as it was asked for. */
  domain: VercelDomainView | null;
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
  /** The project's own domains, which is what a custom-domain deploy adds to. */
  domains: VercelDomainView[];
  /** The repository Vercel builds from, so a deployment can name a ref. */
  repo: VercelRepoView | null;
  error: string | null;
}

/** Where Vercel gets the code it builds, when the project is linked to Git. */
export interface VercelRepoView {
  type: string;
  org: string;
  repo: string;
  /** Vercel's own id for the repository, which a new deployment has to name. */
  repoId: number | null;
  /** The branch a production deployment is built from. */
  productionBranch: string | null;
}

/**
 * What a frontend's deploy page reads before anything has run.
 *
 * The same shape as the backend's `GET /api/plan` — a checklist built from the
 * steps a run would execute — plus the two things a *Vercel* deploy has to show
 * because they are the reason to be on the page at all: the values it is about
 * to write, and where the build would come from.
 */
export interface VercelDeployPreview {
  target: VercelDeployTarget;
  /** Null when the account has no project by that name — reported, not guessed. */
  project: VercelProjectView | null;
  /** The `NEXT_PUBLIC_*` values this deploy would write, and where each came from. */
  variables: EnvRow[];
  /** Where the build would come from, in one sentence. */
  source: string | null;
  /**
   * Why there is nothing to deploy, when there is nothing to deploy — no token,
   * no project, or a stage whose backend has not been deployed. One sentence
   * above the checklist beats six steps that each fail on their own.
   */
  note: string | null;
  steps: StepView[];
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
