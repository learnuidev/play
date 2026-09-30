import fs from "node:fs";
import path from "node:path";
import type { LogStream, RunAction } from "@/lib/types";
import {
  awsJson,
  bucketAccess,
  describeStack,
  describeStacks,
  getIdentity,
  identityError,
  rootStackNames,
  stackLabel,
} from "./aws";
import {
  configFile,
  configProblems,
  defaultCloudFrontPublicKeyIdParam,
  listStages,
  newStageConfig,
  ownershipOf,
  ownsEverything,
  pickSeedStage,
  readConfig,
  stageOutputs,
  writeConfig,
  type StageConfig,
} from "./environments";
import { cdkBin, repoPath } from "./repo";
import { googleClientSecretName, googleSecretStatus } from "./settings";
import { ensureSigningKey, signingKeyParams, signingKeyState } from "./signing-key";
import { display, lastMeaningfulLines, run, type PipedChild } from "./exec";

/**
 * The deploy plan: every step a stage needs, and how each one knows it is done.
 *
 * ## The shape of a step
 *
 * A step has a **check** and an **apply**. The check asks "is this already
 * true?" — and it is not a formality. `cdk bootstrap`, the S3 handover and the
 * config file are all things that are done once and then stay done, and a plan
 * that simply ran them again would be a plan that lies about what it did. So
 * the check runs first, and when it is satisfied the step is a check mark with
 * the reason beside it; when it is not, the work runs.
 *
 * That is what makes a second run of this console cheap and honest: on an
 * environment that is already up, most of the plan reports *already satisfied*
 * and nothing is created. The steps that always run — synth, deploy, the probe
 * — are the ones where running again is free.
 *
 * ## Order
 *
 * The order is the order of `docs/migration.md`'s cutover for a stage that has
 * not been migrated, minus the parts that exist only because a *legacy* stack
 * was in the way. Two of the steps are in their position for a reason that is
 * not obvious and is worth saying here:
 *
 * - the config file comes before the bootstrap, because it is what says which
 *   account to bootstrap in;
 * - the S3 handover comes immediately before the deploy and nowhere else,
 *   because uploads are not processed between the two — the window is the point
 *   of the step.
 */

export interface StepContext {
  stage: string;
  profile: string;
  region: string;
  root: string;
  /** One line into the transcript, as it happens. */
  log: (stream: LogStream, text: string) => void;
  /** The one-line summary drawn beside the step's title while it runs. */
  progress: (note: string) => void;
  /** Values shared between steps: the identity, the outputs, the deployed set. */
  data: Record<string, unknown>;
  /** Hands the live process over, so cancelling the run can kill it. */
  own: (child: PipedChild) => void;
  /**
   * Whether somebody has pressed Stop.
   *
   * A step that runs a command does not need this — the process is killed under
   * it and it returns a signal. A step that *waits* does: a Vercel build is
   * polled until it is ready, and a run whose Stop button took twenty minutes to
   * be obeyed would be a run nobody can stop. The loop asks this between polls.
   */
  stopped: () => boolean;
}

export interface StepOutcome {
  note: string;
  /**
   * Some work reports whether it had anything to do.
   *
   * The bundler and `cdk deploy` both print "nothing to do" as a *success*, and
   * both are run unconditionally because asking them whether there is work is
   * the same cost as doing it. Letting a step say so is what keeps the check
   * marks honest: a second run of an up-to-date environment shows a folded step
   * with the reason beside it, not a tick for work that did not happen.
   */
  status?: "passed" | "skipped";
}

export interface CheckOutcome {
  satisfied: boolean;
  note: string;
}

/**
 * The things two environments share, and the reason a step can be asked to wait.
 *
 * Two stages deploy side by side — they are different stacks, and each writes its
 * own cloud assembly — but a handful of steps are not about one stage at all:
 *
 * - **`checkout`** is this working tree. `infra/dist` is one bundle for every
 *   stage, and `apps/<app>/.env.local` is one file per app that can only name one
 *   environment at a time. Steps under this lock run one at a time, so a bundle
 *   is never written while another run's is being read, and a file is never
 *   half-written.
 * - **`account`** is the AWS account's own singletons: `CDKToolkit`, which is one
 *   stack per account and region however many environments there are, and the
 *   shared videos bucket's notification configuration, which is one document
 *   read, edited and put back.
 *
 * They are two names rather than one lock because they are two different
 * resources: a staging bootstrap should not hold up a dev bundle.
 */
export type LockName = "checkout" | "account";

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  optional?: boolean;
  /**
   * A step whose answer is somebody's decision, not the console's.
   *
   * Its check still runs and its note still reports what it found — but when the
   * check is not satisfied the step stops there rather than applying. For the
   * pre sign-up trigger that is the whole difference between a stage that
   * quietly takes federated sign-up from the stage that had it, and one that
   * says whose it currently is and leaves it alone.
   */
  manual?: boolean;
  /** The line printed when a manual step lands on an answer that is not ours. */
  manualHint?: (ctx: StepContext) => string;
  /** What a satisfied check is called. Defaults to "Already done". */
  satisfiedLabel?: string;
  /** Milliseconds before `apply` is killed. */
  timeoutMs?: number;
  /**
   * The shared resource this step is about, so two runs never touch it at once.
   *
   * The lock is held across the step's check *and* its work: the two are one
   * judgement about one resource, and a check that read a bucket while another
   * run was rewriting its notification configuration would be reading a
   * different question than the one it answered.
   */
  lock?: LockName;
  check?: (ctx: StepContext) => Promise<CheckOutcome>;
  apply: (ctx: StepContext) => Promise<StepOutcome>;
}

/* ------------------------------------------------------------------ *
 * Running things
 * ------------------------------------------------------------------ */

interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Suppress the transcript, for a probe whose output is one number. */
  quiet?: boolean;
  /** Replaces the transcript, for output a step has to read as it arrives. */
  onLine?: (stream: LogStream, text: string) => void;
}

async function exec(
  ctx: StepContext,
  command: string,
  args: string[],
  options: ExecOptions = {},
) {
  if (!options.quiet && !options.onLine) ctx.log("note", `$ ${display(command, args)}`);

  return run(command, args, {
    cwd: options.cwd ?? ctx.root,
    // `cdk` takes its profile from the environment and has no `--profile` flag,
    // which is why the profile is set here rather than passed as an argument —
    // and why the same value is passed explicitly to the scripts that do take
    // one.
    env: {
      AWS_PROFILE: ctx.profile,
      AWS_REGION: ctx.region,
      AWS_DEFAULT_REGION: ctx.region,
      STAGE: ctx.stage,
    },
    onLine: options.onLine ?? (options.quiet ? undefined : ctx.log),
    timeoutMs: options.timeoutMs,
    // Always owned, quiet or not: a process this console cannot kill is a
    // process that outlives it.
    onSpawn: ctx.own,
    detached: true,
  }).catch((error: Error) => {
    throw new Error(`Could not start '${command}': ${error.message}`);
  });
}

/**
 * `cdk`, from `infra/`.
 *
 * **`cdk` finds `cdk.json` — and therefore the app — in the current working
 * directory and nowhere else.** It does not walk up, so running it from the
 * repository root fails with:
 *
 *     --app is required either in command-line, in cdk.json or in ~/.cdk.json
 *
 * which names neither the directory it looked in nor the file it wanted. Every
 * `cdk` invocation goes through here so that the directory is one decision made
 * once rather than three that have to agree.
 *
 * ## Why every invocation names its own assembly directory
 *
 * `cdk` synthesizes into `cdk.out` by default, and that directory is the whole of
 * what `deploy` reads: the templates, and the staged assets beside them. Two runs
 * sharing it would overwrite each other's templates, and the deploy that read the
 * other stage's assembly would report a diff for stacks it was not asked about —
 * a failure that names nothing and is not about anything being wrong. Since two
 * environments can now be deployed at once, each writes `cdk.out/<stage>`, which
 * `infra/.gitignore` already covers with the parent.
 *
 * ## Why that directory is cleared before a synth
 *
 * **CDK never prunes an assembly.** Every synth stages the assets it just built
 * under a content hash and leaves whatever was there before, so a directory that
 * has been synthesized into a few times holds one copy of the handlers per
 * distinct build — a gigabyte for one stage, and the checkout's root `cdk.out`
 * had reached fourteen. Per environment that is a gigabyte kept per environment
 * forever, so this deletes the stage's own directory first: the run that needs it
 * is the run about to write it, `deploy` synthesizes before it deploys, and only
 * one run per stage can be going at a time. `bootstrap` reads no assembly, so it
 * is not worth the delete.
 */
async function cdk(
  ctx: StepContext,
  args: string[],
  options: Omit<ExecOptions, "cwd"> = {},
) {
  const infra = repoPath("infra");
  if (!fs.existsSync(path.join(infra, "cdk.json"))) {
    throw new Error(`No cdk.json in ${infra} — that is the file that names the CDK app.`);
  }

  const output = path.join("cdk.out", ctx.stage);
  if (args[0] === "synth" || args[0] === "deploy") {
    fs.rmSync(path.join(infra, output), { recursive: true, force: true });
  }

  return exec(ctx, cdkBin(), [...args, "--output", output], { ...options, cwd: infra });
}

/** The last few lines of a failure, for a note that names what went wrong. */
function failureNote(result: { stderr: string; stdout: string }): string {
  const lines = lastMeaningfulLines(result.stderr || result.stdout, 4);
  return lines.length ? lines.join(" · ") : "the command failed with no output";
}

function assertOk(
  result: { code: number | null; timedOut: boolean; stderr: string; stdout: string },
  what: string,
  timeoutMs?: number,
): void {
  if (result.timedOut) {
    throw new Error(
      `${what} did not finish within ${Math.round((timeoutMs ?? 0) / 60_000)} minutes and was stopped.`,
    );
  }
  if (result.code !== 0) {
    throw new Error(`${what} failed — ${failureNote(result)}`);
  }
}

/**
 * The export CloudFormation refused to delete, when that is what failed.
 *
 * A cross-stack reference is a CloudFormation *export*, and CloudFormation will
 * not delete one that another stack still imports — so a change that stops
 * exporting something, which is what replacing a resource with a differently
 * named one does, fails on the stack that owns it with one of these two
 * sentences. Both name the export, which is what `exportReaders` needs.
 */
function refusedExportName(output: string): string | undefined {
  const patterns = [
    /Cannot delete export (\S+) as it is in use by/i,
    /Export (\S+) cannot be deleted as it is in use by/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * The stacks of this stage that still import an export.
 *
 * Asked of CloudFormation rather than parsed out of the failure, because that
 * sentence truncates: past a couple of readers it says "(and 2 more)", and
 * `list-imports` answers with every one of them. Filtered to this stage's four
 * root stacks, because the rest of the answer is the nested stacks those roots
 * create — and deploying a root deploys the nested stacks inside it.
 */
async function exportReaders(exportName: string, ctx: StepContext): Promise<string[]> {
  const answer = await awsJson<{ Imports?: string[] }>(
    ["cloudformation", "list-imports", "--export-name", exportName],
    { profile: ctx.profile, region: ctx.region, optional: true },
  );
  const deployable = new Set(rootStackNames(ctx.stage));
  return (answer?.Imports ?? []).filter((name) => deployable.has(name));
}

/**
 * CDK annotations — the one thing `synth` says that is worth reading.
 *
 * The resource-count warning and anything `planGroups` raises arrive as
 * annotations on **stderr**, in the shape:
 *
 *     INFO Number of resources: 417 is approaching allowed maximum of 500 (Construct Annotations)
 *        PlayApiStack-dev/ApiContentRoutes
 *
 * They are the difference between a synth that merely produced templates and
 * one that validated the service, so the checklist quotes the first of them
 * rather than reporting "no warnings" over the top of one. `docs/workspace.md`
 * is where the Content group's count and what to do about it is written down.
 */
function annotations(stderr: string): string[] {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:INFO|WARNING|ERROR)\b/.test(line) && /Annotations?\)/i.test(line))
    .map((line) =>
      line
        .replace(/\s*\((?:Construct )?Annotations?\)\s*$/i, "")
        .replace(/^(?:INFO|WARNING|ERROR)\s+/i, ""),
    );
}

/**
 * The functions whose S3 rule the handover is about to take away.
 *
 * Read out of the script's own plan rather than re-derived here: the script
 * decides which rules collide and which are ours, and a second implementation of
 * that judgement is a second answer to "whose notification is this".
 *
 * ```
 * Would be removed:
 *   play-dev-process-video  [s3:ObjectCreated:* on uploads/]
 * ```
 */
function displacedByPlan(stdout: string): string[] {
  const start = stdout.indexOf("Would be removed:");
  if (start === -1) return [];
  const block = stdout.slice(start + "Would be removed:".length);
  const end = block.indexOf("Would be kept:");
  const body = end === -1 ? block : block.slice(0, end);

  return body
    .split("\n")
    .map((line) => /^\s{2}([\w-]+)\s+\[/.exec(line)?.[1] ?? null)
    .filter((name): name is string => name !== null);
}

/* ------------------------------------------------------------------ *
 * Reading the repository
 * ------------------------------------------------------------------ */

function readEnvLocal(app: string): Record<string, string> {
  const values: Record<string, string> = {};
  try {
    const text = fs.readFileSync(repoPath("apps", app, ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
  } catch {
    // No `.env.local` yet: every value is missing, which is the answer.
  }
  return values;
}

const FRONTEND_APPS = ["studio", "marketplace", "demo"] as const;

/**
 * The identity, and the account the environment claims.
 *
 * The mismatch check is the whole reason this is a step of its own. The stacks
 * take their account and region from `infra/config/play-<stage>.json` rather than
 * from the ambient credentials, so a profile pointing somewhere else does not
 * fail until CDK refuses the first AWS call — halfway through a deploy, with
 * assets already uploaded to the wrong place.
 *
 * It is shared by both plans because it is one question asked in two directions,
 * and it matters more in one of them: a deploy in the wrong account creates
 * stacks nobody wanted, and a **destroy in the wrong account deletes somebody
 * else's environment**. So the sentence it refuses with names the direction it
 * was asked about.
 */
function credentialsStep(stage: string, action: RunAction): PlanStep {
  const stageConfigPath = path.relative(repoPath(), configFile(stage));
  const verb = action === "destroy" ? "Deleting" : "Deploying";

  return {
    id: "credentials",
    title: "This machine can act on the account",
    detail:
      "`aws sts get-caller-identity` with the repository's profile. The account it names has to be the one the environment's config names, because the stacks take their account and region from that file rather than from the credentials.",
    satisfiedLabel: "Verified",
    check: async (ctx) => {
      const identity = await getIdentity({ profile: ctx.profile, region: ctx.region });
      if (!identity) {
        return {
          satisfied: false,
          note: await identityError({ profile: ctx.profile, region: ctx.region }),
        };
      }
      ctx.data.identity = identity;

      const config = readConfig(ctx.stage);
      if (config?.account && config.account !== identity.account) {
        return {
          satisfied: false,
          note: `profile '${ctx.profile}' is account ${identity.account}, but ${stageConfigPath} names ${config.account}`,
        };
      }
      if (config?.region && config.region !== ctx.region) {
        return {
          satisfied: false,
          note: `${stageConfigPath} names region ${config.region}, this console is reading ${ctx.region}`,
        };
      }

      return { satisfied: true, note: `${identity.arn} · account ${identity.account}` };
    },
    apply: async (ctx) => {
      const identity = await getIdentity({ profile: ctx.profile, region: ctx.region });
      if (!identity) {
        throw new Error(await identityError({ profile: ctx.profile, region: ctx.region }));
      }
      const config = readConfig(ctx.stage);
      if (config?.account && config.account !== identity.account) {
        throw new Error(
          `Refusing to continue: profile '${ctx.profile}' resolves to account ${identity.account}, ` +
            `and ${stageConfigPath} says this environment is account ${config.account}. ` +
            `${verb} here would act on the wrong account's stacks.`,
        );
      }
      return { note: `${identity.arn} · account ${identity.account}` };
    },
  };
}

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

export function buildPlan(stage: string): PlanStep[] {
  const stageConfigPath = path.relative(repoPath(), configFile(stage));

  const toolchain: PlanStep = {
    id: "toolchain",
    title: "The tools are on this machine",
    detail:
      "Every step below is a process. This one asks whether `aws`, the workspace's `cdk` and a Node the repository will accept are actually here — because the failure that otherwise arrives is a spawn error in the middle of a deploy.",
    satisfiedLabel: "Present",
    check: async () => {
      const missing: string[] = [];

      const awsResult = await run("aws", ["--version"], { timeoutMs: 20_000 }).catch(() => null);
      const awsVersion =
        awsResult && awsResult.code === 0
          ? `${awsResult.stdout}${awsResult.stderr}`.trim().split("\n")[0]
          : null;
      if (!awsVersion) missing.push("the AWS CLI v2 is not on PATH");

      let cdkVersion: string | null = null;
      try {
        fs.accessSync(cdkBin(), fs.constants.X_OK);
        const manifest = JSON.parse(
          fs.readFileSync(repoPath("node_modules", "aws-cdk", "package.json"), "utf8"),
        ) as { version?: string };
        cdkVersion = `aws-cdk ${manifest.version ?? "unknown"}`;
      } catch {
        missing.push("the CDK CLI is missing — run `npm install` at the repository root");
      }

      const major = Number(process.versions.node.split(".")[0]);
      if (!Number.isFinite(major) || major < 20) {
        missing.push(`node ${process.versions.node} is too old — the repository asks for >= 20`);
      }

      if (missing.length > 0) {
        return { satisfied: false, note: missing.join("; ") };
      }
      return {
        satisfied: true,
        note: `${awsVersion} · ${cdkVersion} · node ${process.versions.node}`,
      };
    },
    apply: async () => {
      throw new Error(
        "The tools this plan needs are not all here. Install what is missing and run the plan again.",
      );
    },
  };

  const credentials = credentialsStep(stage, "deploy");

  /**
   * The config file, and the one step that makes "a new environment" mean
   * something.
   *
   * A stage that already has a file skips this. For a stage that does not there
   * are exactly two cases, and they are not interchangeable:
   *
   * - **The legacy Serverless stack `play-backend-<stage>` is still there.** The
   *   stage predates the CDK migration and its data is real, so the documented
   *   path applies: `import-state.mjs` reads the deployed resources out of AWS
   *   and writes their physical names. This is what `dev` did, and it is the
   *   only case in which a stage imports anything.
   *
   * - **There is no legacy stack.** The stage is new, so there is nothing to
   *   discover and nothing to import. The file is written with `ownership` set
   *   for all three groups, which is what tells the stacks to **create** the
   *   tables, the bucket, the distribution and the user pool rather than reach
   *   for somebody else's. Everything created is this stage's own, is
   *   empty, and is retained if the stack is deleted.
   *
   * The difference between the two is the difference between *a second
   * deployment of dev's data* and *a new environment*. Seeding a new stage from
   * `play-dev.json` would copy `ownership: false` and dev's 27 physical table
   * names along with it — which reads like a new environment and behaves like a
   * second front door to the same database. This step does not do that.
   *
   * What *is* carried over is the settings that are product configuration rather
   * than per-environment state: the mail addresses, the Google client id, the
   * callback URLs, and the CloudFront signing key. Those are the same product in
   * every environment, and a stage that invented its own would be a stage whose
   * Google sign-in does not work.
   */
  const config: PlanStep = {
    id: "config",
    title: "The environment's resources are named",
    detail: `\`${stageConfigPath}\` is what the stacks stand on. A stage that exists already imports the tables, bucket, distribution and pool by physical name; a **new** stage has no such names and is written to create all of them instead — the tables named \`play-<stage>-*\`, the two S3 buckets named by CloudFormation, because an S3 bucket name is unique across every AWS account and \`play-test-videos\` is already somebody else's. Either way a stage without this file cannot synthesize at all.`,
    satisfiedLabel: "On disk",
    check: async (ctx) => {
      const loaded = readConfig(ctx.stage);
      const problems = configProblems(loaded);
      if (problems.length > 0) {
        return { satisfied: false, note: `${stageConfigPath} — ${problems[0]}` };
      }
      const identity = ctx.data.identity as { account?: string } | undefined;
      if (identity?.account && loaded!.account && identity.account !== loaded!.account) {
        return {
          satisfied: false,
          note: `${stageConfigPath} names account ${loaded!.account}, this profile is ${identity.account}`,
        };
      }
      if (ownsEverything(loaded)) {
        return {
          satisfied: true,
          note: `${stageConfigPath} — a new environment, creating its own tables, media and pool`,
        };
      }
      const tables = Object.keys(loaded!.existing?.tables ?? {}).length;
      return {
        satisfied: true,
        note: `${tables} tables imported · bucket ${loaded!.existing?.videosBucket} · pool ${loaded!.existing?.userPoolId}`,
      };
    },
    apply: async (ctx) => {
      const legacy = await describeStack(`play-backend-${ctx.stage}`, {
        profile: ctx.profile,
        region: ctx.region,
      });

      if (legacy) {
        ctx.progress("reading the deployed resources out of AWS");
        const result = await exec(
          ctx,
          "node",
          [
            "infra/scripts/import-state.mjs",
            `--stage=${ctx.stage}`,
            `--profile=${ctx.profile}`,
            `--region=${ctx.region}`,
          ],
          { cwd: ctx.root, timeoutMs: 5 * 60_000 },
        );
        assertOk(result, "import-state.mjs", 5 * 60_000);

        const loaded = readConfig(ctx.stage);
        const problems = configProblems(loaded);
        if (problems.length > 0) {
          throw new Error(`import-state wrote a file that is still incomplete: ${problems.join("; ")}`);
        }
        return {
          note: `discovered from play-backend-${ctx.stage} · ${Object.keys(loaded!.existing?.tables ?? {}).length} tables imported`,
        };
      }

      const seedStage = pickSeedStage(ctx.stage);
      if (!seedStage) {
        throw new Error(
          `No legacy stack 'play-backend-${ctx.stage}' to discover from, and no other stage's ` +
            `config to take the product settings from. Write ${stageConfigPath} by hand — it is ` +
            "the file that says what this environment creates or imports.",
        );
      }

      const seed = readConfig(seedStage)!;
      const identity = ctx.data.identity as { account?: string } | undefined;

      ctx.progress(`writing a new environment`);
      ctx.log(
        "note",
        `No 'play-backend-${ctx.stage}' stack to read, so ${ctx.stage} is a **new environment**: it creates its own tables, videos bucket, CloudFront distribution and Cognito user pool, all named play-${ctx.stage}-* and all empty.`,
      );
      ctx.log(
        "note",
        `It imports nothing, so it cannot read or write another environment's data. The product settings — mail, the Google client id, the callback URLs and the CloudFront signing key — are copied from play-${seedStage}.json, because they are the same product in every environment.`,
      );

      // One function writes a new environment's file, wherever it is written
      // from: here, or the console's Checklist tab, where a person has already
      // supplied the credentials and the seed is only standing in for the ones
      // they did not.
      writeConfig(
        newStageConfig(ctx.stage, seed, {
          account: identity?.account ?? seed.account,
          region: ctx.region ?? seed.region,
        }),
      );

      return {
        note: `new environment written · it creates its own tables, media and user pool`,
      };
    },
  };

  /**
   * The key pair signed video URLs are built on.
   *
   * Next to the config file because it is the same kind of thing: what this
   * environment stands on, named but not created by a deploy. The media stack
   * creates a CloudFront public key *from* the parameter's value, so a stage
   * that creates its own distribution cannot deploy until the pair is there —
   * and the failure without it is a distribution whose key group holds a
   * parameter name rather than a key, which is a 403 on every video.
   *
   * It is a step rather than a note in the README because it is the one piece of
   * a deployment that is neither discovered nor typed: it is generated, it is
   * generated once, and afterwards the check is a check mark. The generation
   * itself is `infra/scripts/ensure-cloudfront-key.mjs`, which never rotates a
   * key that exists — a new pair would invalidate every URL already handed out,
   * which makes rotation a deploy of a new public key rather than a repair.
   *
   * What the step checks is the **pair**, not the id. The id is CloudFront's to
   * assign, to the key the media stack creates, so the media stack is what
   * publishes it — and this step runs before that deploy exists. A stage that
   * imports its distribution already names the id in its config.
   */
  const signingKey: PlanStep = {
    id: "signing-key",
    title: "The CloudFront signing key is in SSM",
    detail: `Signed URLs need a key pair, and neither half is in this repository: the **private** half is read by the handlers at request time, by parameter *name*, and the **public** half is what \`PlayMediaStack\` creates the distribution's public key from. The names come from the environment's config and are **per environment** by default — \`/play/<stage>/cloudfront/private-key\` and its public half — because the pair signs one distribution's URLs and one environment's handlers should not be able to mint URLs for another's. A stage that imports a distribution names the pair that distribution was created against, which is what \`dev\` does. \`infra/scripts/ensure-cloudfront-key.mjs\` writes whichever half is missing and **never replaces one that is there**; the key's CloudFront *id* is a third parameter, written by the media stack during a deploy because that is the stack that owns the key. Rotating is a deploy rather than a repair for the same reason: a CloudFront key is immutable, so a new pair is written at new parameter names, \`cloudFrontKeyVersion\` goes up, and the media stack deploys.`,
    satisfiedLabel: "In SSM",
    timeoutMs: 2 * 60_000,
    check: async (ctx) => {
      const key = await signingKeyState(ctx.stage, { profile: ctx.profile, region: ctx.region });
      if (key.ready) {
        return { satisfied: true, note: `${key.privateParam} · ${key.publicParam}` };
      }
      const missing = !key.privateExists
        ? key.publicExists
          ? `no private half at ${key.privateParam}`
          : `neither half is in SSM`
        : `no public half at ${key.publicParam}`;
      return { satisfied: false, note: `${missing} — a key that exists is never rotated` };
    },
    apply: async (ctx) => {
      const ensured = await ensureSigningKey(ctx.stage, { profile: ctx.profile, region: ctx.region });
      for (const line of ensured.lines) ctx.log("out", line);
      return { note: ensured.note, status: "passed" };
    },
  };

  const bootstrap: PlanStep = {
    id: "bootstrap",
    title: "CDK is bootstrapped in this account and region",
    detail:
      "`cdk deploy` uploads each function's bundle and each template to a bucket that the toolkit stack owns — `CDKToolkit`, one per account and region. It is a one-time install, and it is idempotent: bootstrapping again only updates it.",
    satisfiedLabel: "Bootstrapped",
    timeoutMs: 5 * 60_000,
    // One toolkit stack per account and region, however many environments there
    // are: two `cdk bootstrap` runs at once are two updates to one stack, and the
    // second is refused as already in progress.
    lock: "account",
    check: async (ctx) => {
      const toolkit = await describeStack("CDKToolkit", {
        profile: ctx.profile,
        region: ctx.region,
      });
      if (!toolkit) {
        return {
          satisfied: false,
          note: `no CDKToolkit stack in ${ctx.region} — run \`cdk bootstrap\` once for this account`,
        };
      }
      if (!toolkit.healthy) {
        return { satisfied: false, note: `CDKToolkit is ${stackLabel(toolkit.status)}` };
      }
      return { satisfied: true, note: `CDKToolkit is ${stackLabel(toolkit.status)} in ${ctx.region}` };
    },
    apply: async (ctx) => {
      const identity = ctx.data.identity as { account?: string } | undefined;
      const account = identity?.account ?? readConfig(ctx.stage)?.account;
      if (!account) throw new Error("The account could not be resolved, so bootstrap cannot target it.");

      const result = await cdk(ctx, ["bootstrap", `aws://${account}/${ctx.region}`], {
        timeoutMs: 5 * 60_000,
      });
      assertOk(result, "cdk bootstrap", 5 * 60_000);
      return { note: `bootstrapped aws://${account}/${ctx.region}` };
    },
  };

  /**
   * Bundling, and why the check matters here.
   *
   * `cdk synth` does not build anything: the stacks reference finished
   * directories under `infra/dist`, and a missing one is an ENOENT naming a path
   * under `dist/`. So this step is not an optimisation — it is the difference
   * between a synth that validates the service and a synth that validates the
   * last person's build.
   *
   * The check compares the newest source edit against the oldest bundle. It is
   * deliberately conservative: anything it cannot read counts as stale, and the
   * bundler is incremental anyway, so a wrong "stale" costs seconds.
   */
  /**
   * Bundling, and why it is not a build step that can be skipped.
   *
   * `cdk synth` does not build anything: the stacks reference finished
   * directories under `infra/dist`, and a missing one is an ENOENT naming a path
   * under `dist/`. So a bundle that is stale is not a slow deploy — it is a
   * deploy of the last person's code.
   *
   * There is deliberately **no check**: the bundler already keeps esbuild's
   * metafile beside its output and rebuilds only the handlers whose real
   * dependency graph moved, so asking it whether there is work costs the same as
   * doing it. The step reads what it said and marks itself satisfied when the
   * answer was "nothing to rebuild".
   */
  const bundle: PlanStep = {
    id: "bundle",
    title: "The handlers are bundled",
    detail:
      "esbuild, once, into `infra/dist` — one directory per handler, rebuilt only when something in its metafile changed. Not `NodejsFunction`, which would run esbuild 134 times at synth and put every handler's sourcemap in one zip, over Lambda's 250 MB unzipped limit.",
    satisfiedLabel: "Up to date",
    timeoutMs: 15 * 60_000,
    // `infra/dist` is one bundle for every stage, and esbuild writing it while a
    // second bundler is deciding what is stale is two answers to one question.
    lock: "checkout",
    apply: async (ctx) => {
      const result = await exec(ctx, "node", ["infra/scripts/bundle.mjs"], {
        timeoutMs: 15 * 60_000,
      });
      assertOk(result, "the bundler", 15 * 60_000);

      const current = /^(\d+) handlers already bundled/m.exec(result.stdout);
      if (current) {
        return { note: `${current[1]} handlers already bundled`, status: "skipped" };
      }
      const rebuilt = /^Bundling (\d+) of (\d+) handlers/m.exec(result.stdout);
      if (rebuilt) {
        return { note: `${rebuilt[1]} of ${rebuilt[2]} handlers rebuilt` };
      }
      return { note: "the bundler finished; read the transcript for what it rebuilt" };
    },
  };

  /**
   * Synthesis, which is the only thing that validates the service as a whole.
   *
   * It is also where `planGroups` runs: the rule that a path's first segment
   * belongs to exactly one nested stack. Two stacks creating the same gateway
   * resource is a route that works until it does not, so the check is worth the
   * minute.
   */
  const synth: PlanStep = {
    id: "synth",
    title: "The templates synthesize",
    detail:
      "`cdk synth` builds all four stacks locally, resolves every route's path, and refuses if a path root is unclaimed or claimed twice — each API group builds its own slice of the gateway's resource tree, and two stacks creating `me` is two resources with one path part.",
    timeoutMs: 15 * 60_000,
    apply: async (ctx) => {
      // No `--all`: `synth` is not one of the commands that takes it (it
      // synthesizes the whole app unless it is given stack names), and passing
      // it earns an "Unknown option(s)" complaint on every run that reads like
      // a problem and is not one.
      const result = await cdk(ctx, ["synth", "--quiet", "--context", `stage=${ctx.stage}`], {
        timeoutMs: 15 * 60_000,
      });
      assertOk(result, "cdk synth", 15 * 60_000);

      const notes = annotations(result.stderr);
      return {
        note: notes.length > 0 ? `synthesized · ${notes[0]}` : "synthesized with no annotations",
      };
    },
  };
  /**
   * The S3 handover — required, destructive to another stage, and unavoidable.
   *
   * `put-bucket-notification-configuration` replaces a bucket's whole
   * notification configuration, and CDK's handler is deliberately conservative
   * about a bucket it did not create: it treats every rule it finds as somebody
   * else's and appends its own. Two rules for the same event with an overlapping
   * prefix are rejected outright, so the deploy fails with "Configuration is
   * ambiguously defined" — an error that names nothing anybody can act on.
   *
   * ## The part that is worth saying out loud
   *
   * The bucket is imported and shared, and **it can notify exactly one function
   * for `uploads/`**. So handing it over is not tidying up a leftover: it takes
   * video processing away from whichever stage held it. Deploying `staging`
   * therefore stops `dev` processing uploads, and there is no arrangement in
   * which both work — which is why this says so in its detail, names the
   * function it is about to displace in its check, and names the one it moved
   * from in its note. A step this consequential should not read as housekeeping.
   *
   * Uploads are also not processed *between* this running and the deploy that
   * follows. That window is the reason it is a step rather than something a
   * deploy does quietly before showing a diff — and the reason the note says
   * what it does.
   */
  const handover: PlanStep = {
    id: "handover",
    title: "The videos bucket has one owner",
    detail:
      "Only matters when the bucket is **imported**: one bucket can notify one function for `uploads/`, so two stages cannot both process uploads, and handing it over **takes video processing away from whichever stage held it**. An environment that creates its own bucket has no one to hand anything to — this step is a check mark and nothing happens.",
    satisfiedLabel: "One owner",
    timeoutMs: 5 * 60_000,
    // The script reads the bucket's whole notification configuration, decides
    // which rules collide, and puts it back. Two of those interleaved would each
    // decide against a document the other had already replaced.
    lock: "account",
    check: async (ctx) => {
      if (ownershipOf(readConfig(ctx.stage)).media) {
        return ownedBucketCheck(ctx);
      }

      const result = await exec(
        ctx,
        "node",
        [
          "infra/scripts/handover-s3-notifications.mjs",
          `--stage=${ctx.stage}`,
          `--profile=${ctx.profile}`,
          `--region=${ctx.region}`,
          "--plan",
        ],
        { cwd: ctx.root, timeoutMs: 2 * 60_000 },
      );
      if (result.code !== 0) {
        return { satisfied: false, note: failureNote(result) };
      }
      if (/nothing to do/i.test(result.stdout)) {
        return {
          satisfied: true,
          note: `the bucket's only uploads/ rule is play-${ctx.stage}-process-video`,
        };
      }
      const displaced = displacedByPlan(result.stdout);
      return {
        satisfied: false,
        note: displaced.length
          ? `${displaced.join(", ")} holds the bucket's uploads/ notification — this deploy takes video processing from ${displaced.length === 1 ? "it" : "them"}`
          : "the bucket carries an uploads/ rule that is not this deployment's",
      };
    },
    apply: async (ctx) => {
      if (ownershipOf(readConfig(ctx.stage)).media) {
        // The check is the whole of the work for an owned bucket: nothing to
        // hand over, but possibly something in the way. A name that cannot be
        // created halts here rather than at CloudFormation's early validation,
        // which names the bucket and not the reason.
        const verdict = await ownedBucketCheck(ctx);
        if (!verdict.satisfied) {
          throw new Error(
            `${verdict.note}\n\nA deploy cannot start until the bucket a config *names* can be created. ` +
              "Leaving videosBucketName out of the config is the other way round it: CloudFormation " +
              "names the bucket, and a generated name cannot be taken.",
          );
        }
        return { note: "nothing to hand over — this environment's bucket is its own" };
      }

      const result = await exec(
        ctx,
        "node",
        [
          "infra/scripts/handover-s3-notifications.mjs",
          `--stage=${ctx.stage}`,
          `--profile=${ctx.profile}`,
          `--region=${ctx.region}`,
          "--yes",
        ],
        { cwd: ctx.root, timeoutMs: 5 * 60_000 },
      );
      assertOk(result, "the S3 handover", 5 * 60_000);

      const removed = displacedByPlan(result.stdout);
      return {
        note: removed.length
          ? `video processing moved off ${removed.join(", ")}; this stage's deploy adds its own rule`
          : "the colliding rules were removed; this stage's deploy adds its own",
      };
    },
  };

  /**
   * The Google client secret, in Secrets Manager — for a pool this stage creates.
   *
   * **Only matters when the pool is created.** CloudFormation refuses an SSM
   * Secure reference in `AWS::Cognito::UserPoolIdentityProvider`'s
   * `ProviderDetails.client_secret` —
   *
   *   SSM Secure reference is not supported in:
   *   [AWS::Cognito::UserPoolIdentityProvider/Properties/ProviderDetails/client_secret]
   *
   * — and refuses it in `AWS::SecretsManager::Secret`'s own `SecretString` too,
   * so the value cannot be moved across declaratively either. A
   * `secretsmanager` reference *is* accepted in that property, so the value has
   * to be in Secrets Manager before the auth stack deploys, and
   * `provision-google-secret.mjs` is what puts it there.
   *
   * An imported pool already has its Google provider attached — attached by
   * hand, years ago — and no deploy touches it, so `dev` never needs this.
   */
  const providerSecret: PlanStep = {
    id: "secret",
    title: "This environment's Google credentials are set",
    detail:
      "A pool this stage **creates** is built with a Google identity provider, and CloudFormation refuses an SSM Secure reference in it (`ProviderDetails.client_secret`), so the client secret has to be in **Secrets Manager** before the auth stack deploys. The console's **Checklist** tab writes it — along with the client id and the callback URLs — and the same tab is what says whether this environment has one. An imported pool already has its provider attached, and a stage with no client id is created without one.",
    satisfiedLabel: "Credentials set",
    timeoutMs: 60_000,
    check: async (ctx) => {
      const loaded = readConfig(ctx.stage);
      if (!ownershipOf(loaded).auth) {
        return {
          satisfied: true,
          note: "this environment's pool is imported — its Google provider is already attached",
        };
      }
      if (!loaded?.auth?.googleClientId) {
        return {
          satisfied: true,
          note: "no Google client id, so the pool is created without a provider",
        };
      }

      const name = googleClientSecretName(ctx.stage);
      const found = await googleSecretStatus(ctx.stage, {
        profile: ctx.profile,
        region: ctx.region,
      });
      return found
        ? { satisfied: true, note: `${name} holds this environment's client secret` }
        : {
            satisfied: false,
            note: `no secret at ${name} — set the Google client id and secret in the Checklist tab`,
          };
    },
    apply: async (ctx) => {
      // Not something this step can do *for* you, and that is the point: the
      // secret is a credential somebody supplies, not one to be copied out of
      // another environment's parameter. Halting here with a sentence beats
      // letting the deploy fail inside Cognito with a provider that has no
      // secret.
      throw new Error(
        `There is no Google client secret for '${ctx.stage}' at ${googleClientSecretName(ctx.stage)}.\n\n` +
          `Open the Checklist tab of ${ctx.stage} — Backends → ${ctx.stage} — and save the Google ` +
          "client id and secret there. The auth stack cannot create the identity provider " +
          "without them.\n\n" +
          "To remove Google sign-in from this environment instead, clear the client id there and " +
          "the pool will be created without a provider.",
      );
    },
  };

  /**
   * The deploy itself.
   *
   * No check, on purpose: there is no cheap way to ask "would this change
   * anything" other than by running the diff, and the deploy already is one.
   * Running it again against an environment that is up is a no-op at
   * CloudFormation's level — which is the property that matters, and the note
   * says which of the two happened.
   *
   * ## Why this can be two deploys, and why that is not a retry
   *
   * An export that a stack still imports cannot be deleted, and `cdk deploy
   * --all` deploys the stack that *provides* an export before the stack that
   * reads it. So the one change that cannot land in a single pass is the change
   * that **removes a cross-stack reference**: the provider runs first, refuses to
   * drop the export, and the reader — whose new template no longer reads it —
   * never gets its turn. That is a real change rather than a transient failure:
   * making a CloudFront signing key rotatable is exactly this, because a key's id
   * stops crossing stacks.
   *
   * Reported to a person, it is a sentence in a terminal about export names and
   * `--exclusively`. Here it is the deploy doing what that sentence asks —
   * `refusedExportName` finds the export, `exportReaders` finds who still imports
   * it, those stacks deploy on their own first, and then everything deploys. What
   * the person sees is a deploy that worked.
   */
  const deploy: PlanStep = {
    id: "deploy",
    title: "The four stacks deploy",
    detail:
      "Data, media, auth and the API, then the four nested stacks the routes are divided into. Nothing here holds data: the tables, the bucket, the distribution and the pool are imported, so a deploy cannot change or delete one.",
    timeoutMs: 60 * 60_000,
    apply: async (ctx) => {
      /** `<stack>: 'changed' | 'unchanged'`, as CDK reports each one. */
      const perStack = new Map<string, "changed" | "unchanged">();

      // The transcript and a parser both, which is why `exec` takes the line
      // handler rather than always writing to the transcript itself.
      const onLine = (stream: LogStream, text: string) => {
        ctx.log(stream, text);
        // ` ✅  PlayApiStack-dev (no changes)`. The variation selector is
        // optional in the pattern because whether an emoji carries U+FE0F
        // depends on how it was typed, and a regex that assumes one silently
        // stops matching when somebody's terminal or CDK version differs.
        const match = /^\s*(?:✅|❌|✨|✔|ℹ)\uFE0F?\s+(Play\S+)\s*(\(no changes\))?/.exec(
          text.replace(/^\s+/, " "),
        );
        if (match) {
          perStack.set(match[1], match[2] ? "unchanged" : "changed");
          const changed = [...perStack.values()].filter((v) => v === "changed").length;
          const same = [...perStack.values()].filter((v) => v === "unchanged").length;
          ctx.progress(`${changed} changed · ${same} already in place`);
        }
      };

      const options = { timeoutMs: 60 * 60_000, onLine };
      const args = (...extra: string[]) => [
        "deploy",
        ...extra,
        "--require-approval",
        "never",
        "--progress",
        "events",
        "--context",
        `stage=${ctx.stage}`,
      ];

      let result = await cdk(ctx, args("--all"), options);

      // Bounded rather than `if`: a deploy can be removing more than one
      // cross-stack reference — rolling a stage from an older shape of the app
      // can drop two — and each one is found, unblocked and retried the same way.
      // An export is unblocked once: if the same one is refused again, the
      // readers' own deploy did not drop the import, and repeating it would only
      // spend another ten minutes arriving at the same sentence.
      const unblocked = new Set<string>();

      for (let recovered = 0; recovered < 3 && result.code !== 0 && !result.timedOut; recovered++) {
        const refused = refusedExportName(`${result.stdout}\n${result.stderr}`);
        if (!refused || unblocked.has(refused)) break;
        unblocked.add(refused);

        const readers = await exportReaders(refused, ctx);
        if (readers.length === 0) break;

        ctx.log(
          "out",
          `\nCloudFormation will not delete the export ${refused} while ${readers.join(", ")}\n` +
            `still import${readers.length === 1 ? "s" : ""} it, and CDK deploys the stack that provides an export\n` +
            "before the stacks that read it. Deploying the readers on their own first, so their\n" +
            "templates stop importing it, then deploying everything.\n\n",
        );

        // `--exclusively`, or CDK would drag the providing stack in ahead of
        // these and hit the same wall: `cdk deploy <stack>` deploys that stack's
        // dependencies with it unless it is told not to.
        const first = await cdk(ctx, args(...readers, "--exclusively"), options);
        assertOk(first, `cdk deploy ${readers.join(" ")}`, 60 * 60_000);

        result = await cdk(ctx, args("--all"), options);
      }

      assertOk(result, "cdk deploy", 60 * 60_000);

      const changed = [...perStack.entries()].filter(([, v]) => v === "changed");
      const unchanged = [...perStack.entries()].filter(([, v]) => v === "unchanged");

      ctx.data.deployedStacks = [...perStack.keys()];

      if (perStack.size === 0) {
        return { note: "the deploy finished; read the transcript for the per-stack result" };
      }
      if (changed.length === 0) {
        return {
          note: `nothing to change — all ${unchanged.length} stacks were already in place`,
          status: "skipped",
        };
      }
      return {
        note: `${changed.length} stack${changed.length === 1 ? "" : "s"} changed${
          unchanged.length ? `, ${unchanged.length} already in place` : ""
        }`,
      };
    },
  };

  /**
   * The post-condition, and the one place the run's result is read.
   *
   * `*_COMPLETE` is not enough on its own: `UPDATE_ROLLBACK_COMPLETE` also ends
   * in it, and it means the change was rolled back. `stackHealthy` is the set of
   * statuses that mean settled, and this step is where that distinction is
   * enforced rather than assumed.
   */
  const verify: PlanStep = {
    id: "verify",
    title: "Every stack is complete, with its outputs",
    detail:
      "The four root stacks settle and carry the outputs an app needs — the API URL from the API stack, the pool, its client and the Hosted UI domain from the auth stack. `UPDATE_ROLLBACK_COMPLETE` also ends in `_COMPLETE`; it means the opposite.",
    satisfiedLabel: "Verified",
    check: async (ctx) => {
      const details = await describeStacks(rootStackNames(ctx.stage), {
        profile: ctx.profile,
        region: ctx.region,
      });
      if (details.length < 4) {
        return {
          satisfied: false,
          note: `${details.length} of 4 root stacks exist — the deploy has not completed`,
        };
      }
      const unhealthy = details.filter((detail) => !detail.healthy);
      if (unhealthy.length > 0) {
        return {
          satisfied: false,
          note: unhealthy
            .map((detail) => `${detail.name} is ${stackLabel(detail.status)}`)
            .join("; "),
        };
      }
      const merged = details.reduce<Record<string, string>>(
        (acc, detail) => ({ ...acc, ...detail.outputs }),
        {},
      );
      const missing = [
        ["ApiUrl", merged.ApiUrl],
        ["CognitoUserPoolId", merged.CognitoUserPoolId],
        ["CognitoUserPoolClientId", merged.CognitoUserPoolClientId],
      ].filter(([, value]) => !value);

      if (missing.length > 0) {
        return {
          satisfied: false,
          note: `the stacks are deployed but are missing ${missing.map(([k]) => k).join(", ")}`,
        };
      }

      ctx.data.stacks = details.map((detail) => ({
        name: detail.name,
        status: detail.status,
        healthy: detail.healthy,
        nested: false,
      }));
      ctx.data.outputs = await stageOutputs(ctx.stage, {
        profile: ctx.profile,
        region: ctx.region,
      });

      return { satisfied: true, note: `4 root stacks complete · API ${merged.ApiUrl}` };
    },
    apply: async (ctx) => {
      const details = await describeStacks(rootStackNames(ctx.stage), {
        profile: ctx.profile,
        region: ctx.region,
      });
      const unhealthy = details.filter((detail) => !detail.healthy);
      if (unhealthy.length > 0) {
        throw new Error(
          unhealthy.map((detail) => `${detail.name} is ${stackLabel(detail.status)}`).join("; "),
        );
      }
      ctx.data.stacks = details.map((detail) => ({
        name: detail.name,
        status: detail.status,
        healthy: detail.healthy,
        nested: false,
      }));
      return { note: `${details.length} root stacks complete` };
    },
  };

  /**
   * Pointing the apps at it.
   *
   * This is `docs/migration.md` step five, and it is here because a deployment
   * nobody's frontend points at is not a deployment anybody can see.
   * `get-env.mjs` writes the two stacks' outputs into each `.env.local` and
   * leaves every key it does not manage alone — which matters, because the
   * demo's OAuth client id is minted in the studio and exists nowhere else.
   */
  const point: PlanStep = {
    id: "point",
    title: "The three apps point at it",
    detail:
      "`scripts/get-env.mjs` reads the API and auth stack outputs into each app's `.env.local`, and preserves every key it does not manage — the demo's OAuth client id is minted in the studio and exists nowhere else. **A file names one environment**, so a deploy here points the apps at *this* stage and away from whichever stage they read before — and if two environments are deployed at once, at whichever of them reached this step last.",
    satisfiedLabel: "Pointed at it",
    timeoutMs: 5 * 60_000,
    // One file per app, and it names one environment: two runs writing them at
    // once would interleave a key from each. Whoever runs last is what the apps
    // read afterwards, which is the same answer two sequential deploys give.
    lock: "checkout",
    check: async (ctx) => {
      const outputs = (await stageOutputs(ctx.stage, {
        profile: ctx.profile,
        region: ctx.region,
      })) as Awaited<ReturnType<typeof stageOutputs>>;
      if (!outputs.apiUrl) {
        return { satisfied: false, note: "the API stack has no ApiUrl output yet" };
      }
      ctx.data.outputs = outputs;

      const stale = FRONTEND_APPS.filter(
        (app) => readEnvLocal(app).NEXT_PUBLIC_API_URL !== outputs.apiUrl,
      );
      if (stale.length === 0) {
        return {
          satisfied: true,
          note: `studio, marketplace and demo all read ${outputs.apiUrl}`,
        };
      }
      return {
        satisfied: false,
        note: `${stale.join(", ")} ${stale.length === 1 ? "is" : "are"} not pointed at ${outputs.apiUrl}`,
      };
    },
    apply: async (ctx) => {
      for (const app of FRONTEND_APPS) {
        const result = await exec(
          ctx,
          "node",
          [
            "scripts/get-env.mjs",
            `--stage=${ctx.stage}`,
            `--profile=${ctx.profile}`,
            `--region=${ctx.region}`,
            `--out=apps/${app}/.env.local`,
          ],
          { cwd: ctx.root, timeoutMs: 2 * 60_000 },
        );
        assertOk(result, `get-env for ${app}`, 2 * 60_000);
      }
      const outputs = await stageOutputs(ctx.stage, {
        profile: ctx.profile,
        region: ctx.region,
      });
      ctx.data.outputs = outputs;
      return { note: `wrote .env.local for studio, marketplace and demo · ${outputs.apiUrl}` };
    },
  };

  /**
   * The probe.
   *
   * Two calls a stranger could make, and both are public on purpose: `GET
   * /catalog/courses` carries no authorizer — a catalog behind a login is a
   * catalog nobody reads — and the CORS preflight above it is what a browser
   * sends first. A 200 on both is the shortest proof that the gateway, the
   * missing authorizer and at least one Lambda are wired to each other.
   */
  const probe: PlanStep = {
    id: "probe",
    title: "The API answers",
    detail:
      "Two calls a stranger could make: a CORS preflight, and the public catalog, which carries no authorizer on purpose. A 200 on both is what proves the gateway and a Lambda are wired to each other — a deployed API that returns 403 to everything looks identical from the stack's side.",
    satisfiedLabel: "Answering",
    timeoutMs: 60_000,
    check: async (ctx) => {
      const outputs = await outputsFor(ctx);
      if (!outputs?.apiUrl) {
        return { satisfied: false, note: "there is no API URL to call yet" };
      }
      const health = await callApi(outputs.apiUrl);
      if (health.ok) {
        ctx.log("note", `GET ${outputs.apiUrl}/catalog/courses → ${health.catalogStatus}`);
        return { satisfied: true, note: health.note };
      }
      return { satisfied: false, note: health.note };
    },
    apply: async (ctx) => {
      const outputs = await outputsFor(ctx);
      if (!outputs?.apiUrl) throw new Error("There is no API URL to call.");
      const health = await callApi(outputs.apiUrl);
      if (!health.ok) throw new Error(health.note);
      return { note: health.note };
    },
  };

  /**
   * The pre sign-up trigger — the one step the console reports instead of doing.
   *
   * **Only relevant when the pool is imported.** An imported pool's
   * `LambdaConfig.PreSignUp` cannot be set from CDK, so every stage deploys its
   * own `link-federated-user` and **the pool can only call one of them** —
   * repointing it is not a step toward a working deploy, it is a decision about
   * which stage owns federated sign-up for everybody.
   *
   * That is why this is `manual: true` rather than merely optional. An optional
   * step that applied itself would, on a staging run, quietly take sign-up away
   * from dev: a change to a shared resource, made on behalf of somebody who
   * pressed a button labelled "deploy this environment". The check still runs
   * and still says whose the trigger is; the command to change it is printed
   * beside that, for whoever decides it should be.
   *
   * An environment that creates its own pool has none of this: the pool is built
   * with `preSignUp` already pointing at its own function, so the step passes
   * without anybody deciding anything.
   */
  const trigger: PlanStep = {
    id: "trigger",
    title: "The pool's pre sign-up trigger points here",
    detail:
      "Only matters when the pool is **imported**: nothing deployed can set `LambdaConfig.PreSignUp` on someone else's pool, so `adopt-cognito.mjs` calls `UpdateUserPool` instead, reading the pool first because that call replaces every setting it is not given. One pool, one trigger — repointing it takes federated sign-up away from whichever stage had it, so this is reported rather than done. An environment that creates its own pool wires the trigger at deploy time and this is a check mark.",
    optional: true,
    manual: true,
    satisfiedLabel: "Already points here",
    manualHint: (ctx) =>
      [
        "Left as it is. This stage's own trigger function is deployed and works; the pool can only call one, and which one is a decision rather than a step.",
        "",
        `To move it to this stage anyway:`,
        "",
        `  node infra/scripts/adopt-cognito.mjs --stage=${ctx.stage} --profile=${ctx.profile} --region=${ctx.region}`,
      ].join("\n"),
    timeoutMs: 3 * 60_000,
    check: async (ctx) => {
      const loaded = readConfig(ctx.stage);
      if (ownershipOf(loaded).auth) {
        return {
          satisfied: true,
          note: `this environment's own pool, wired to play-${ctx.stage}-link-federated-user at deploy`,
        };
      }

      const poolId = loaded?.existing?.userPoolId;
      if (!poolId) return { satisfied: false, note: "the config names no user pool" };

      const expected = `arn:aws:lambda:${ctx.region}:${
        (ctx.data.identity as { account?: string } | undefined)?.account ?? loaded?.account
      }:function:play-${ctx.stage}-link-federated-user`;

      const pool = await describeUserPool(poolId, ctx);
      if (!pool) return { satisfied: false, note: `pool ${poolId} could not be read` };

      const current = pool.LambdaConfig?.PreSignUp;
      if (current === expected) {
        return { satisfied: true, note: `the pool calls play-${ctx.stage}-link-federated-user` };
      }
      if (!current) {
        return { satisfied: false, note: "the pool has no pre sign-up trigger" };
      }
      return {
        satisfied: false,
        note: `the pool calls ${current.split(":function:")[1] ?? current}, not this stage's`,
      };
    },
    apply: async (ctx) => {
      const result = await exec(
        ctx,
        "node",
        [
          "infra/scripts/adopt-cognito.mjs",
          `--stage=${ctx.stage}`,
          `--profile=${ctx.profile}`,
          `--region=${ctx.region}`,
        ],
        { cwd: ctx.root, timeoutMs: 3 * 60_000 },
      );
      assertOk(result, "adopt-cognito.mjs", 3 * 60_000);
      return { note: `the pool now calls play-${ctx.stage}-link-federated-user` };
    },
  };

  return [
    toolchain,
    credentials,
    config,
    signingKey,
    bootstrap,
    bundle,
    synth,
    handover,
    providerSecret,
    deploy,
    verify,
    point,
    probe,
    trigger,
  ];
}

/* ------------------------------------------------------------------ *
 * The destroy plan
 * ------------------------------------------------------------------ */

/**
 * Deleting an environment: the stacks, then everything they stood on.
 *
 * The unit is the same one deployment uses — a stage — and what this removes is
 * the four CloudFormation stacks **and the data behind them**: the tables, both
 * buckets and the video in them, the CloudFront distribution and the key that
 * signs for it, the user pool with every account in it, every log group, and this
 * stage's secrets. `infra/config/play-<stage>.json` goes last, because it is the
 * only written record of what the environment stood on until the moment it does
 * not.
 *
 * ## Why the data goes with the stacks
 *
 * Every stateful resource in this app is `RemovalPolicy.RETAIN`, so `cdk destroy`
 * alone stops at the stacks: the tables, both buckets, the distribution, the pool
 * and every log group stay in AWS with nobody managing them. That default is
 * right for a *deploy* — a table replaced by CloudFormation is an empty table,
 * and `docs/migration.md` phase E is that argument — but it made "delete this
 * environment" an operation nobody could finish:
 *
 * - **A redeploy of the same name stops at early validation.** CloudFormation
 *   will not create a `play-<stage>-*` table, a named bucket or a log group that
 *   already exists, and it fails with a sentence that names the resource and
 *   nothing anybody can act on. The ways out were to deploy under a second name
 *   or to delete twenty-eight tables by hand in the console, one at a time.
 * - **They cost money for nothing.** A user pool, a distribution and a bucket
 *   full of video are most of what an environment costs, and an environment
 *   nobody can deploy to again is an environment that is paying for itself.
 *
 * So a delete here is a delete. What is removed is what the environment's config
 * names, what CloudFormation named after it (`play-<stage>-*`,
 * `playmediastack-<stage>-*`), and what only the stacks knew how to name — a
 * generated bucket, an imported distribution's id — which is why the destroy step
 * reads those out of the stack outputs *before* the stacks go.
 *
 * ## The two things standing in front of it
 *
 * - **A second stage's config.** A table, a bucket, a distribution or a pool that
 *   another stage's config also names belongs to both of them, and this delete
 *   would take it away from the one still using it. For a pool that is sign-up
 *   silently stopping for that stage — the failure the old trigger check existed
 *   to prevent, which is now the same question as every other shared resource and
 *   is answered once, up front, by `shared`. It refuses rather than reporting,
 *   because the delete cannot be *completed* while it is true.
 * - **The typed stage name**, which is asked for on the page before this run
 *   exists at all. Nothing in this plan asks again.
 *
 * ## The order
 *
 * The stacks first, and only then the data. Two reasons, and the second is the
 * one that decides it: a table deleted under a live Lambda is a hundred failed
 * requests in a log nobody will read, and — more to the point — the last thing a
 * delete should do is take the API away and leave an environment that half works.
 * After the stacks are gone the resources are unreachable by everything except
 * this console, which is exactly when removing them is safe.
 *
 * Within the data: the distribution before the buckets it writes its access logs
 * into and reads its video from, the tables and the media before the pool, and
 * the log groups after everything — they are the only record of what the
 * environment did, and losing them should be the last thing that happens rather
 * than the first.
 */
export function buildDestroyPlan(stage: string): PlanStep[] {
  const stageConfigPath = path.relative(repoPath(), configFile(stage));

  /**
   * The one thing a delete can break that is not this environment.
   *
   * Two stages sharing a resource is not hypothetical in this repository: it is
   * what an *imported* pool is, and `teardown-legacy-stack.sh` refuses to delete
   * a Serverless stack for the same reason — the pool can call exactly one
   * stage's `link-federated-user` function, and deleting the environment that
   * owns it takes sign-up away from the pool everybody else signs in through.
   * The old check watched only that trigger, because the pool outlived the
   * stacks and a delete could not touch it. Now that a delete takes the pool with
   * it, the question is the one it always was underneath: **is another stage's
   * config still naming this?**
   *
   * Read from the configs rather than from AWS, and deliberately: what makes a
   * resource shared is that two stages point at it, and `infra/config/*.json` is
   * where pointing lives. A resource this stage's config names and no other's
   * does is this stage's to delete, whichever way it was created.
   */
  const shared: PlanStep = {
    id: "shared",
    title: "Nothing else stands on what this environment stands on",
    detail:
      "A table, a bucket, a distribution or a user pool that another stage's config also names belongs to both of them, and a delete here would take it away from the one still using it — for a pool that is sign-up quietly stopping for that stage, for a table it is another environment's product data. This step reads every other `infra/config/play-*.json` and refuses rather than reporting, because the delete cannot be completed correctly while it is true. It runs before anything has been destroyed, so a refusal costs nothing but the reading.",
    satisfiedLabel: "Nothing shared",
    timeoutMs: 60_000,
    check: async (ctx) => {
      const conflicts = sharingConflicts(ctx.stage);
      if (conflicts.length === 0) {
        return {
          satisfied: true,
          note: `no other stage's config names a table, bucket, pool or distribution of '${ctx.stage}'`,
        };
      }
      return { satisfied: false, note: describeConflicts(conflicts) };
    },
    apply: async (ctx) => {
      const conflicts = sharingConflicts(ctx.stage);
      if (conflicts.length === 0) return { note: "nothing shared" };
      throw new Error(
        `Refusing to delete '${ctx.stage}': ${describeConflicts(conflicts)}. ` +
          "Deleting this environment would delete those, and the stage that still uses them would stop " +
          "working with nothing in its own console to say why.\n\n" +
          "Point that stage at resources of its own first — its config is infra/config/play-<stage>.json — " +
          "or delete it first and this one afterwards.",
      );
    },
  };

  /**
   * The destroy itself.
   *
   * `--force` is not a convenience: there is no terminal here. Every process this
   * console starts has stdin on `ignore`, so CDK's "are you sure" would take the
   * question and get an end-of-file — the run would stop on a prompt nobody can
   * see. The confirmation this operation has is the typed stage name on the page,
   * which is asked for before the run exists at all.
   *
   * There is **no check that makes this unnecessary**, and the check that is here
   * is the opposite of one: it asks whether any stack exists, so that deleting an
   * environment somebody has already emptied is a check mark rather than a CDK
   * run against nothing. It is also where the reads this plan cannot make
   * afterwards happen — `ApiUrl`, and the `VideosBucketName`, `CloudFrontDomain`
   * and pool id that only the stacks know — because the steps after it delete
   * what those name and the last one reports what is still pointed at this
   * environment.
   */
  const destroy: PlanStep = {
    id: "destroy",
    title: "The four stacks are destroyed",
    detail:
      "`cdk destroy --all --context stage=<stage>`: the API, its 158 functions, the gateway, the roles and the nested stacks that hold the routes. **The data is not part of this**: the 27 tables, both buckets, the user pool and every log group are `RemovalPolicy.RETAIN`, so CloudFormation stops managing them and leaves them where they are — the five steps after this one are what delete them. The distribution is the one resource that splits: a stage that **created** its own has it in this stack, so it goes here (CloudFormation disables it and waits, which is most of this step's time), and a stage that **imported** one has no stack that owns it, so `media` is what deletes that one. What stops working, either way, is everything that talks to this environment's API, and the last step says what that is.",
    satisfiedLabel: "Nothing to destroy",
    timeoutMs: 60 * 60_000,
    check: async (ctx) => {
      const details = await describeStacks(rootStackNames(ctx.stage), {
        profile: ctx.profile,
        region: ctx.region,
      });
      if (details.length === 0) {
        return {
          satisfied: true,
          note: `no stack of '${ctx.stage}' exists in ${ctx.region}`,
        };
      }

      // Read now, because the stack that publishes it is about to go, and the
      // report compares it against what the three apps are reading.
      const merged = details.reduce<Record<string, string>>(
        (acc, detail) => ({ ...acc, ...detail.outputs }),
        {},
      );
      ctx.data.apiUrlBefore = merged.ApiUrl ?? null;
      ctx.data.stacksBefore = details.map((detail) => detail.name);

      // The three names only the stacks know. A bucket CloudFormation named has
      // a random suffix no file holds, the distribution's *domain* is how its id
      // is found once the stack that published it is gone, and a stage that
      // creates its own pool names it nowhere else. Everything the steps after
      // this one delete is discovered from here plus the config, which is why
      // this is read in the check — the last moment before the stacks go.
      ctx.data.resourcesBefore = {
        videosBucket: merged.VideosBucketName ?? null,
        cloudFrontDomain: merged.CloudFrontDomain ?? null,
        userPoolId: merged.CognitoUserPoolId ?? null,
      };

      return {
        satisfied: false,
        note: `${details.length} of 4 root stacks exist${merged.ApiUrl ? ` · API ${merged.ApiUrl}` : ""}`,
      };
    },
    apply: async (ctx) => {
      /** `<stack>: 'destroyed' | 'failed'`, as CDK reports each one. */
      const perStack = new Map<string, "destroyed" | "failed">();

      const onLine = (stream: LogStream, text: string) => {
        ctx.log(stream, text);
        // ` ✅  PlayApiStack-staging: destroyed`. The variation selector is
        // optional in the pattern for the reason it is optional in the deploy
        // step: whether an emoji carries U+FE0F depends on how it was typed.
        const match = /^\s*(?:✅|❌)\uFE0F?\s+(Play[^\s:]+)/.exec(text.replace(/^\s+/, " "));
        if (match) {
          perStack.set(match[1], text.includes("❌") ? "failed" : "destroyed");
          const gone = [...perStack.values()].filter((value) => value === "destroyed").length;
          ctx.progress(`${gone} of ${perStack.size} destroyed`);
        }
      };

      const result = await cdk(
        ctx,
        ["destroy", "--all", "--force", "--context", `stage=${ctx.stage}`],
        { timeoutMs: 60 * 60_000, onLine },
      );
      assertOk(result, "cdk destroy", 60 * 60_000);

      const gone = [...perStack.values()].filter((value) => value === "destroyed").length;
      if (perStack.size === 0) {
        return { note: "the destroy finished; read the transcript for the per-stack result" };
      }
      return { note: `${gone} stack${gone === 1 ? "" : "s"} destroyed` };
    },
  };

  /**
   * The post-condition, and the reason the config file is deleted after it.
   *
   * A stack in `DELETE_FAILED` is a stack that has mostly gone and is waiting for
   * something — a bucket with objects in it, a resource somebody deleted by hand.
   * That is precisely when the config file must *stay*: it is the record of what
   * the environment stood on, and a failed delete is the case where somebody will
   * want it. So this step comes before the file goes, and a stack still standing
   * stops the run here.
   */
  const verify: PlanStep = {
    id: "verify",
    title: "No stack of this environment is left",
    detail:
      "The four root stacks are gone. A stack in `DELETE_FAILED` has mostly been deleted and is waiting for whatever blocked it, which is the state where the config file is still worth having: this step stops there rather than letting the environment be forgotten.",
    satisfiedLabel: "Gone",
    timeoutMs: 5 * 60_000,
    check: async (ctx) => {
      const details = await describeStacks(rootStackNames(ctx.stage), {
        profile: ctx.profile,
        region: ctx.region,
      });
      if (details.length === 0) {
        return { satisfied: true, note: "all four root stacks are gone" };
      }
      return {
        satisfied: false,
        note: details.map((detail) => `${detail.name} is ${stackLabel(detail.status)}`).join("; "),
      };
    },
    apply: async (ctx) => {
      const details = await describeStacks(rootStackNames(ctx.stage), {
        profile: ctx.profile,
        region: ctx.region,
      });
      throw new Error(
        details.length === 0
          ? "The stacks are gone; this step should have been satisfied."
          : `${details.map((detail) => `${detail.name} is ${stackLabel(detail.status)}`).join("; ")}. ` +
            `Clear what blocked the deletion and delete this environment again — ${stageConfigPath} is ` +
            "still there, and it is what a second attempt reads.",
      );
    },
  };

  /**
   * The tables: the product's own data, and the first thing a delete removes.
   *
   * The names come from two places, because a stage acquires tables two ways: a
   * config that **imports** them names every one (`existing.tables`, keyed by the
   * logical id the handlers know by), and one that **created** them has
   * twenty-seven tables CloudFormation named `play-<stage>-*`. Both are read here
   * and matched against what the account actually holds, so a config naming a
   * table somebody deleted by hand is a name this step does not try to delete.
   */
  const data: PlanStep = {
    id: "data",
    title: "The tables are gone",
    detail:
      "Every DynamoDB table this environment stands on is deleted: the ones its config names because it imported them, and the ones CloudFormation named `play-<stage>-*` because it created them. **This is the product's data** — courses, lessons, progress, members, invitations, API keys — and there is no copy of it anywhere else. Point-in-time recovery is what stands between an accident and this step while a table exists, and deleting the table deletes that window with it: this is the step in this plan that cannot be undone by deploying again.",
    satisfiedLabel: "No tables",
    timeoutMs: 30 * 60_000,
    check: async (ctx) => {
      const { tables } = await resourcesOf(ctx);
      if (tables.length === 0) {
        return { satisfied: true, note: `no table of '${ctx.stage}' exists in ${ctx.region}` };
      }
      return {
        satisfied: false,
        note: `${tables.length} table${tables.length === 1 ? "" : "s"} — ${listNames(tables)}`,
      };
    },
    apply: async (ctx) => {
      const { tables } = await resourcesOf(ctx);
      for (const table of tables) {
        ctx.progress(`deleting ${table}`);
        await awsRun(
          ctx,
          ["dynamodb", "delete-table", "--table-name", table],
          `aws dynamodb delete-table ${table}`,
          5 * 60_000,
        );
        // The CLI's own waiter rather than a sleep: DynamoDB deletes a table
        // asynchronously, and the *next* run of this plan is what reads the
        // answer — out of `list-tables`, in this step's own check. A step that
        // ended when the request was accepted would leave that second run
        // reporting tables that are already on their way out.
        await awsRun(
          ctx,
          ["dynamodb", "wait", "table-not-exists", "--table-name", table],
          `waiting for ${table} to be deleted`,
          20 * 60_000,
        );
      }
      return { note: `${tables.length} table${tables.length === 1 ? "" : "s"} deleted` };
    },
  };

  /**
   * The media: the distribution, the key that signs for it, and both buckets.
   *
   * The order is the whole step. A distribution that is still there keeps writing
   * access logs into the logs bucket, keeps serving the video, and — the part
   * that fails rather than merely wastes — keeps the public key it trusts
   * undeletable: CloudFront refuses to delete a key a key group still lists, and
   * refuses to delete a key group a distribution still trusts. So the
   * distribution goes first, then the key group and the key, then the buckets it
   * was pointed at.
   *
   * The distribution is also the one resource that means different things in the
   * two modes, which is why this step reads rather than assumes. A stage that
   * **created** its media has its distribution in `PlayMediaStack-<stage>`, and
   * `cdk destroy` has already deleted it — this step then finds nothing, which is
   * the check mark it should be. A stage that **imports** its media has no stack
   * that owns it: the legacy distribution belongs to nobody, no deploy can
   * replace it and no destroy can remove it, and that is the case this step was
   * written for.
   */
  const media: PlanStep = {
    id: "media",
    title: "The media is gone",
    detail:
      "The CloudFront distribution, the key group and public key behind it, and both S3 buckets with everything in them — uploaded video, transcoded ladders, thumbnails, subtitles, and the distribution's own access logs. A bucket is emptied before it is deleted, because S3 refuses to delete one that holds anything, and a distribution is disabled and waited for before it is deleted, because CloudFront refuses to delete one that is still enabled. That wait is minutes of propagating a change to every edge location, and it is the longest thing this plan does.",
    satisfiedLabel: "No media",
    timeoutMs: 90 * 60_000,
    check: async (ctx) => {
      const parts: string[] = [];
      const { buckets } = await resourcesOf(ctx);
      const distribution = await distributionOf(ctx);
      if (distribution) {
        parts.push(`the distribution ${distribution.id}${distribution.enabled ? " (enabled)" : ""}`);
      }
      for (const bucket of buckets) parts.push(`the bucket ${bucket}`);
      if (parts.length === 0) {
        return { satisfied: true, note: `no bucket and no distribution of '${ctx.stage}' exists` };
      }
      return { satisfied: false, note: listNames(parts) };
    },
    apply: async (ctx) => {
      // Read once, before anything goes: the distribution is where two of these
      // bucket names come from — the video it reads and the logs it writes — so a
      // second read after it has been deleted would find neither.
      const { buckets } = await resourcesOf(ctx);
      const notes: string[] = [];

      const distribution = await distributionOf(ctx);
      if (distribution) notes.push(await deleteDistribution(ctx, distribution));

      for (const bucket of buckets) {
        ctx.progress(`emptying ${bucket}`);
        await awsRun(
          ctx,
          ["s3", "rm", `s3://${bucket}`, "--recursive", "--quiet"],
          `aws s3 rm s3://${bucket} --recursive`,
          60 * 60_000,
        );
        ctx.progress(`deleting ${bucket}`);
        await awsRun(ctx, ["s3api", "delete-bucket", "--bucket", bucket], `aws s3api delete-bucket ${bucket}`);
        notes.push(`${bucket} emptied and deleted`);
      }

      if (notes.length === 0) {
        return { status: "skipped", note: "there was no bucket and no distribution left to delete" };
      }
      return { note: notes.join(" · ") };
    },
  };

  /**
   * The pool, and everyone who signed up through it.
   *
   * Its own step because it is the one deletion here that is about **people**
   * rather than about storage. `docs/migration.md` says the pool is the last
   * thing to move and the one to think hardest about, and this is why: the
   * accounts are not rows this console can put back, a person who signed up here
   * has to sign up again, and Google sign-in has nothing to link to until they
   * do.
   */
  const auth: PlanStep = {
    id: "auth",
    title: "The user pool is gone, with every account in it",
    detail:
      "The Cognito user pool this environment signs people in through is deleted, and a pool takes its accounts, its groups, its clients and its Hosted UI domain with it. None of that comes back: a redeploy of the same name creates a **new** pool, empty, and everybody who had an account has to make another one — including through Google, since the address they use now has nothing to link to. An environment whose config **imports** an older pool is deleting that pool, not one of its own.",
    satisfiedLabel: "No pool",
    timeoutMs: 10 * 60_000,
    check: async (ctx) => {
      const poolId = await userPoolOf(ctx);
      if (!poolId) return { satisfied: true, note: `no user pool of '${ctx.stage}' exists` };

      const pool = await describeUserPool(poolId, ctx);
      if (!pool) return { satisfied: true, note: `${poolId} is already gone` };

      const accounts = pool.EstimatedNumberOfUsers ?? 0;
      return {
        satisfied: false,
        note: `${poolId} — about ${accounts} account${accounts === 1 ? "" : "s"}, and every one of them goes`,
      };
    },
    apply: async (ctx) => {
      const poolId = await userPoolOf(ctx);
      if (!poolId) return { status: "skipped", note: "there is no user pool to delete" };

      await awsRun(
        ctx,
        ["cognito-idp", "delete-user-pool", "--user-pool-id", poolId],
        `aws cognito-idp delete-user-pool ${poolId}`,
        5 * 60_000,
      );
      // The pool's own domain goes with it, and that part is asynchronous: the
      // delete returns while Cognito is still letting go of
      // `<pool>.auth.<region>.amazoncognito.com`, which is long enough that a
      // deploy of the same stage name can arrive before it does. Nothing here
      // waits for it — a redeploy is minutes of work either way — and this step's
      // own check is what would notice, on a second run, a pool that is still
      // there.
      return { note: `${poolId} deleted, with its domain and every account in it` };
    },
  };

  /**
   * The record of what the environment did.
   *
   * Log groups are `RemovalPolicy.RETAIN` for a reason that has nothing to do
   * with a delete: they outlive a stack so that a destroyed environment is not a
   * destroyed record of what went wrong in it. That is worth keeping right up
   * until the moment the environment is being removed on purpose — and they are
   * also the first thing that stops a redeploy of the same name, because
   * CloudFormation will not create a log group that already exists and says so
   * with a sentence that names the group and not the reason.
   */
  const traces: PlanStep = {
    id: "traces",
    title: "The log groups are gone",
    detail:
      "Every `/aws/lambda/play-<stage>-*` log group is deleted — one per function, a hundred and fifty-odd of them. They are the only record of what this environment did: which requests arrived, which failed, and every stack trace somebody would read to find out why. Deleting them is why a redeploy of the same name works, and they go **after** the data rather than before it, so that the evidence outlives the delete instead of the other way round.",
    satisfiedLabel: "No log groups",
    timeoutMs: 15 * 60_000,
    check: async (ctx) => {
      const groups = await logGroupsOf(ctx);
      if (groups.length === 0) {
        return { satisfied: true, note: `there are no log groups under /aws/lambda/play-${ctx.stage}*` };
      }
      return {
        satisfied: false,
        note: `${groups.length} log group${groups.length === 1 ? "" : "s"} — the record of what this environment did`,
      };
    },
    apply: async (ctx) => {
      const groups = await logGroupsOf(ctx);
      let done = 0;
      for (const group of groups) {
        await awsRun(
          ctx,
          ["logs", "delete-log-group", "--log-group-name", group],
          `aws logs delete-log-group ${group}`,
        );
        done += 1;
        ctx.progress(`${done} of ${groups.length} log groups deleted`);
      }
      return {
        status: groups.length === 0 ? "skipped" : "passed",
        note: groups.length === 0 ? "there was nothing to delete" : `${groups.length} log groups deleted`,
      };
    },
  };

  /**
   * The key pair, the key's id, and the Google client secret.
   *
   * These are the leftovers the Checklist would otherwise have to create again
   * before a redeploy of the same name could work, and two of the three are
   * *secrets* rather than data — which is why they go last, after everything that
   * holds actual content, and why the whole step is small enough to read.
   */
  const secrets: PlanStep = {
    id: "secrets",
    title: "This environment's signing key and secrets are gone",
    detail:
      "The CloudFront URL-signing key pair in SSM (`cloudFrontPrivateKeyParam` and `cloudFrontPublicKeyParam`, the private half a `SecureString`), the parameter the media stack publishes the key's id to, and the Google client secret in Secrets Manager. **A stage that imports its distribution is the exception**: its config names the *shared* `/play/cloudfront/*` pair — the one an older distribution was created against — and that pair is not this stage's to delete, so it is reported rather than removed. A new environment creates its own pair from the Checklist, which is what makes deleting these safe.",
    satisfiedLabel: "Nothing left",
    timeoutMs: 5 * 60_000,
    check: async (ctx) => {
      const { mine, shared } = secretParameters(ctx.stage);
      // Recorded, not merely noted: these are the leftovers the run's report is
      // for, and a step that is satisfied on a second run has to say the same
      // thing the first one did.
      for (const name of shared) noteLeft(ctx, sharedKeyLine(name));

      const present = await parameterNames(ctx, mine);
      const secret = await googleSecretExists(ctx);
      const found = [...present, ...(secret ? [googleClientSecretName(ctx.stage)] : [])];

      if (found.length === 0) {
        return {
          satisfied: true,
          note: shared.length
            ? `nothing of this environment's own — ${shared.join(" and ")} are shared and stay`
            : "there is nothing of this environment's left in SSM or Secrets Manager",
        };
      }
      return { satisfied: false, note: found.join(" · ") };
    },
    apply: async (ctx) => {
      const { mine, shared } = secretParameters(ctx.stage);
      const notes: string[] = [];
      for (const name of shared) {
        noteLeft(ctx, sharedKeyLine(name));
        notes.push(`${name} is shared`);
      }

      const present = await parameterNames(ctx, mine);
      if (present.length > 0) {
        await awsRun(
          ctx,
          ["ssm", "delete-parameters", "--names", ...present],
          `aws ssm delete-parameters ${present.join(" ")}`,
        );
        notes.unshift(`${present.length} SSM parameter${present.length === 1 ? "" : "s"} deleted`);
      }

      if (await googleSecretExists(ctx)) {
        // Without recovery: the secret is configuration the Checklist writes
        // again, and a delete that left it in a seven-day queue would be a name
        // that exists and refuses to be created.
        await awsRun(
          ctx,
          [
            "secretsmanager",
            "delete-secret",
            "--secret-id",
            googleClientSecretName(ctx.stage),
            "--force-delete-without-recovery",
          ],
          "aws secretsmanager delete-secret",
        );
        notes.unshift("the Google client secret deleted");
      }

      if (notes.length === 0) return { status: "skipped", note: "there was nothing to delete" };
      return { note: notes.join(" · ") };
    },
  };

  /**
   * What is still pointed here — the one thing a delete cannot undo for you.
   *
   * The apps' own `.env.local` files are written by the deploy plan's twelfth
   * step and unwritten by nothing: a frontend reading a deleted API URL is a
   * product that does not work, and the fix is somebody pointing it at another
   * environment. That is a decision rather than a step, which is the same
   * distinction the deploy plan's pre sign-up step makes — so this step
   * **reports instead of applying**, and its transcript is the account of what
   * the delete did and could not do. The check is satisfied by finding what it
   * expected, and the run's own report is the lines below.
   */
  const left: PlanStep = {
    id: "left",
    title: "What is still pointed here",
    detail:
      "The delete removed the stacks and everything they stood on. What it cannot remove is a `.env.local` in this checkout naming the API URL it just deleted — the deploy plan's twelfth step writes those and nothing unwrites them, so the three apps would go on talking to an address that answers with a DNS failure until somebody points them somewhere else. That is a decision about which environment the apps are for, so this step reports it and stops.",
    satisfiedLabel: "Reported",
    timeoutMs: 3 * 60_000,
    check: async (ctx) => {
      // What the delete could not take with it, collected by the steps above:
      // today that is a signing key pair a migrating stage shares with an older
      // distribution, and a public key a second key group still trusts. Written
      // as the steps find them rather than predicted here, and empty on an
      // environment that had neither.
      const lines: string[] = [...(readLeft(ctx) ?? [])];

      // What is still pointed here: the three apps, which the deploy plan's
      // twelfth step writes and nothing unwrites.
      const apiUrl = ctx.data.apiUrlBefore as string | null | undefined;
      if (apiUrl) {
        const pointing = FRONTEND_APPS.filter((app) => readEnvLocal(app).NEXT_PUBLIC_API_URL === apiUrl);
        if (pointing.length > 0) {
          lines.push(
            `${pointing.join(", ")} still read${pointing.length === 1 ? "s" : ""} this environment's API ` +
              `URL in .env.local — anything they send now fails. Start them against another environment, ` +
              "or deploy this one again.",
          );
        }
      }

      for (const line of lines) ctx.log("out", line);
      ctx.data.left = lines;

      return {
        satisfied: true,
        note: lines.length
          ? `${lines.length} thing${lines.length === 1 ? "" : "s"} to read — open this step`
          : "nothing is pointed at what was deleted",
      };
    },
    apply: async () => ({ note: "reported, not applied" }),
  };

  /**
   * The environment itself: the file that makes this stage exist.
   *
   * Last, and only once the stacks and the data are gone. The config is a tracked
   * file, so this is a change to commit rather than a fact in AWS — and for a
   * stage that *imported* its resources it was also the only written record of
   * which tables, which bucket and which pool that stage stood on, which is the
   * cost of the console doing this rather than somebody deleting a file.
   */
  const config: PlanStep = {
    id: "config",
    title: "The environment's config file is removed",
    detail: `\`${stageConfigPath}\` is what makes this stage an environment: the stacks read it for the account, the region, the ownership of the tables, the media and the pool, and for the product settings. Removing it is what takes the environment out of the console — and it is a **tracked file**, so it is a change to commit. Nothing is left in AWS under this name once it is gone, so a stage that **created** its own resources is re-created by deploying it again: the Checklist, then the deploy button. A stage that **imported** its resources is the other case, and the one worth reading before deleting it: the legacy stack that made those resources is long gone, so a redeploy of the same name finds nothing to import — the way back is the migration's own, \`docs/migration.md\` phase E, or a config in which \`ownership\` is \`true\` and this stack creates what it stands on.`,
    satisfiedLabel: "Already gone",
    check: async () => {
      return fs.existsSync(configFile(stage))
        ? { satisfied: false, note: `${stageConfigPath} is still there` }
        : { satisfied: true, note: `there is no ${stageConfigPath}` };
    },
    apply: async () => {
      fs.rmSync(configFile(stage));
      return {
        note: `removed ${stageConfigPath} — the environment is gone from the console; commit the deletion`,
      };
    },
  };

  return [
    credentialsStep(stage, "destroy"),
    shared,
    destroy,
    verify,
    data,
    media,
    auth,
    traces,
    secrets,
    left,
    config,
  ];
}

/* ------------------------------------------------------------------ *
 * Small helpers the steps lean on
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * What a delete has to find before it can delete it
 * ------------------------------------------------------------------ */

/** One resource of one environment, and the name it answers to. */
interface SharedUse {
  what: string;
  name: string;
  stage: string;
}

/**
 * Everything a stage's config names, by physical name.
 *
 * A map rather than a list because the sentence a refusal prints wants "the
 * videos bucket" rather than the field it came from — a table is named by logical
 * id (`VideosTable`) and a bucket by what it is for (`videosBucket`), and neither
 * is what AWS calls them.
 */
function resourceNamesOf(config: StageConfig | null): Map<string, string> {
  const named = new Map<string, string>();
  const existing = config?.existing;

  for (const [id, table] of Object.entries(existing?.tables ?? {})) {
    named.set(table, `the ${id} table`);
  }

  const pairs: Array<[string | undefined, string]> = [
    [existing?.videosBucket, "the videos bucket"],
    [existing?.cloudFrontLogsBucket, "the CloudFront logs bucket"],
    [config?.videosBucketName, "the videos bucket"],
    [config?.cloudFrontLogsBucketName, "the CloudFront logs bucket"],
    [existing?.userPoolId, "the user pool"],
    [existing?.cloudFrontDistributionId, "the CloudFront distribution"],
    [existing?.cloudFrontDomain, "the CloudFront distribution"],
  ];
  for (const [name, what] of pairs) {
    if (name) named.set(name, what);
  }

  return named;
}

/**
 * The resources of one stage that a second stage's config also names.
 *
 * One comparison in both directions: what *this* stage's config names, against
 * every other config's names. A resource neither file names cannot be found this
 * way — a bucket CloudFormation named, a pool nobody wrote down — and that is the
 * right limit, because two stages can only share what both of them point at, and
 * a config is where pointing lives.
 */
function sharingConflicts(stage: string): SharedUse[] {
  const mine = resourceNamesOf(readConfig(stage));
  const conflicts: SharedUse[] = [];

  for (const other of listStages()) {
    if (other === stage) continue;
    const theirs = resourceNamesOf(readConfig(other));
    for (const [name, what] of mine) {
      if (theirs.has(name)) conflicts.push({ what, name, stage: other });
    }
  }

  return conflicts;
}

function describeConflicts(conflicts: SharedUse[]): string {
  return conflicts
    .map((conflict) => `${conflict.what} '${conflict.name}' is also named by '${conflict.stage}'`)
    .join("; ");
}

/** What of one environment is still in the account, by name. */
interface StageResources {
  tables: string[];
  buckets: string[];
  userPoolId: string | null;
}

/**
 * What of this stage's is actually there — three sources, all of them reads.
 *
 * What the config names, what the destroy step read off the stacks before they
 * went, and what the account holds under names CloudFormation built from the
 * stage (`play-<stage>-*` for tables, `playmediastack-<stage>-*` for a bucket it
 * named). The intersection matters more than the union: a config naming a table
 * somebody deleted by hand is not a table this plan can delete, and a step whose
 * check counted it would fail on its own apply.
 *
 * The distribution's own two buckets are in the list because they are the names
 * an **importing** stage is not required to hold anywhere: the bucket it reads
 * its video from and the one it writes its access logs into are written down in
 * the distribution's configuration and nowhere else.
 */
async function resourcesOf(ctx: StepContext): Promise<StageResources> {
  const config = readConfig(ctx.stage);
  const before = ctx.data.resourcesBefore as { videosBucket?: string | null } | undefined;

  const listedTables = await awsJson<{ TableNames?: string[] }>(["dynamodb", "list-tables"], {
    profile: ctx.profile,
    region: ctx.region,
    optional: true,
  }).catch(() => null);
  const held = new Set(listedTables?.TableNames ?? []);

  const tables = new Set<string>();
  for (const name of Object.values(config?.existing?.tables ?? {})) {
    if (held.has(name)) tables.add(name);
  }
  for (const name of held) {
    if (name.startsWith(`play-${ctx.stage}-`)) tables.add(name);
  }

  const listedBuckets = await awsJson<{ Buckets?: Array<{ Name: string }> }>(["s3api", "list-buckets"], {
    profile: ctx.profile,
    region: ctx.region,
    optional: true,
  }).catch(() => null);
  const present = new Set((listedBuckets?.Buckets ?? []).map((bucket) => bucket.Name));

  const distribution = await distributionOf(ctx);
  const named = [
    config?.existing?.videosBucket,
    config?.existing?.cloudFrontLogsBucket,
    config?.videosBucketName,
    config?.cloudFrontLogsBucketName,
    before?.videosBucket,
    ...(distribution?.buckets ?? []),
  ];

  const buckets = new Set<string>();
  for (const candidate of named) {
    if (candidate && present.has(candidate)) buckets.add(candidate);
  }
  // And the ones no file holds, which is the whole reason this reads the account
  // rather than the config: CloudFormation names a bucket after the stack that
  // made it, and a stack is named after its stage. `play-backend-<stage>-` is the
  // same rule for buckets the legacy Serverless stack left behind, which nothing
  // has named since the day that stack was deleted.
  for (const name of present) {
    if (name.startsWith(`playmediastack-${ctx.stage}-`) || name.startsWith(`play-backend-${ctx.stage}-`)) {
      buckets.add(name);
    }
  }

  return {
    tables: [...tables].sort(),
    buckets: [...buckets].sort(),
    userPoolId: await userPoolOf(ctx),
  };
}

/**
 * The pool this environment signs people in through, as a name.
 *
 * Three answers, in the order the environment can know them: what the destroy
 * step read out of the auth stack before it went, what the config names because
 * this stage imported it, and — for a stage that created its own pool and whose
 * stacks are already gone — the Hosted UI domain, which is derived from the stage
 * and the account and is therefore the one name of a pool that outlives the stack
 * that made it.
 */
async function userPoolOf(ctx: StepContext): Promise<string | null> {
  const before = (ctx.data.resourcesBefore as { userPoolId?: string | null } | undefined)?.userPoolId;
  if (before) return before;

  const config = readConfig(ctx.stage);
  if (config?.existing?.userPoolId) return config.existing.userPoolId;

  const account = (ctx.data.identity as { account?: string } | undefined)?.account ?? config?.account;
  if (!account) return null;

  const answer = await awsJson<{ DomainDescription?: { UserPoolId?: string } }>(
    ["cognito-idp", "describe-user-pool-domain", "--domain", `play-${ctx.stage}-${account}`],
    { profile: ctx.profile, region: ctx.region, optional: true },
  ).catch(() => null);

  return answer?.DomainDescription?.UserPoolId ?? null;
}

/**
 * The log groups of one stage, by the name rule rather than by the prefix.
 *
 * `--log-group-name-prefix /aws/lambda/play-dev` also matches
 * `/aws/lambda/play-development-*`, so the prefix is a candidate list and the
 * filter is what decides: a group of this environment is `play-<stage>` exactly,
 * or `play-<stage>-` and then a function.
 */
async function logGroupsOf(ctx: StepContext): Promise<string[]> {
  const answer = await awsJson<{ logGroups?: Array<{ logGroupName: string }> }>(
    ["logs", "describe-log-groups", "--log-group-name-prefix", `/aws/lambda/play-${ctx.stage}`],
    { profile: ctx.profile, region: ctx.region, optional: true },
  ).catch(() => null);

  const exact = `/aws/lambda/play-${ctx.stage}`;
  return (answer?.logGroups ?? [])
    .map((group) => group.logGroupName)
    .filter((name) => name === exact || name.startsWith(`${exact}-`))
    .sort();
}

/* ------------------------------------------------------------------ *
 * CloudFront, which is the long half of a delete
 * ------------------------------------------------------------------ */

/** A distribution, as much of it as a delete needs. */
interface CloudFrontDistribution {
  id: string;
  enabled: boolean;
  /** The configuration as CloudFront returns it, for the round trip below. */
  config: Record<string, unknown>;
  /** The `ETag` of that configuration, which every write has to match. */
  etag: string;
  /** The buckets behind it: the origin it reads, and where its logs go. */
  buckets: string[];
  /** The key groups its behaviours trust, which is what holds the public key. */
  keyGroups: string[];
}

/**
 * The distribution this environment stands on, if it is still there.
 *
 * Two ways to find one, because the two modes write down different things. A
 * config that **imports** its media names the distribution's id. A stage that
 * creates its own never does — an id is CloudFront's to assign — so the second
 * way is the *domain*, which the media stack publishes as `CloudFrontDomain` and
 * the destroy step reads before the stack goes, matched against every
 * distribution in the account.
 */
async function distributionOf(ctx: StepContext): Promise<CloudFrontDistribution | null> {
  const config = readConfig(ctx.stage);
  const before = ctx.data.resourcesBefore as { cloudFrontDomain?: string | null } | undefined;

  const named = config?.existing?.cloudFrontDistributionId;
  if (named) {
    const found = await readDistribution(ctx, named);
    if (found) return found;
  }

  const domain = config?.existing?.cloudFrontDomain ?? before?.cloudFrontDomain ?? null;
  if (!domain) return null;

  const list = await awsJson<{ DistributionList?: { Items?: Array<{ Id: string; DomainName: string }> } }>(
    ["cloudfront", "list-distributions"],
    { profile: ctx.profile, region: ctx.region, optional: true },
  ).catch(() => null);
  const match = (list?.DistributionList?.Items ?? []).find((one) => one.DomainName === domain);

  return match ? readDistribution(ctx, match.Id) : null;
}

async function readDistribution(
  ctx: StepContext,
  id: string,
): Promise<CloudFrontDistribution | null> {
  const answer = await awsJson<{
    ETag?: string;
    Distribution?: {
      Id?: string;
      DistributionConfig?: {
        Enabled?: boolean;
        Origins?: { Items?: Array<{ DomainName?: string }> };
        Logging?: { Bucket?: string };
        DefaultCacheBehavior?: { TrustedKeyGroups?: { Items?: string[] } };
      };
    };
  }>(["cloudfront", "get-distribution", "--id", id], {
    profile: ctx.profile,
    region: ctx.region,
    optional: true,
  }).catch(() => null);

  const distribution = answer?.Distribution;
  if (!distribution?.Id) return null;

  const config = distribution.DistributionConfig ?? {};
  const buckets = new Set<string>();
  for (const origin of config.Origins?.Items ?? []) {
    // `<bucket>.s3.us-east-1.amazonaws.com`, `<bucket>.s3.amazonaws.com`, or the
    // dualstack spelling of either. The bucket is everything before the `.s3`.
    const match = /^(.*)\.s3[.-]/.exec(origin.DomainName ?? "");
    if (match) buckets.add(match[1]);
  }
  const logs = /^(.*)\.s3[.-]/.exec(config.Logging?.Bucket ?? "");
  if (logs) buckets.add(logs[1]);

  return {
    id: distribution.Id,
    enabled: config.Enabled ?? false,
    config: config as Record<string, unknown>,
    etag: answer?.ETag ?? "",
    buckets: [...buckets],
    keyGroups: config.DefaultCacheBehavior?.TrustedKeyGroups?.Items ?? [],
  };
}

/**
 * Takes a distribution off CloudFront, in the four calls it takes.
 *
 * Disable, wait, delete, and then the keys — and there is no shorter version.
 * CloudFront will not delete an enabled distribution, an update of one is
 * asynchronous, and the delete needs the `ETag` of the configuration as it stands
 * *after* the disable, which is why the id is read a second time between the two
 * writes. The wait is `aws cloudfront wait`, the CLI's own poller: a disable is
 * not finished when the API returns, and the only signal that it is finished is
 * the distribution reading `Deployed` again.
 *
 * The key group and the public key go last and in that order, for the reason the
 * step's own note gives: each one holds the next undeletable while it exists, and
 * a key that is still trusted cannot be removed.
 */
async function deleteDistribution(
  ctx: StepContext,
  distribution: CloudFrontDistribution,
): Promise<string> {
  if (distribution.enabled) {
    ctx.progress(`disabling ${distribution.id}`);
    await awsRun(
      ctx,
      [
        "cloudfront",
        "update-distribution",
        "--id",
        distribution.id,
        "--if-match",
        distribution.etag,
        "--distribution-config",
        // The configuration CloudFront handed over, with one field changed:
        // `UpdateDistribution` replaces everything it is not given, so anything
        // filtered out of this would be a setting silently reset on a
        // distribution that is about to be deleted anyway.
        JSON.stringify({ ...distribution.config, Enabled: false }),
      ],
      `aws cloudfront update-distribution ${distribution.id}`,
      10 * 60_000,
    );

    ctx.progress(`waiting for ${distribution.id} to be disabled`);
    await awsRun(
      ctx,
      ["cloudfront", "wait", "distribution-deployed", "--id", distribution.id],
      `waiting for ${distribution.id} to be disabled`,
      45 * 60_000,
    );
  }

  const current = await readDistribution(ctx, distribution.id);
  ctx.progress(`deleting ${distribution.id}`);
  await awsRun(
    ctx,
    [
      "cloudfront",
      "delete-distribution",
      "--id",
      distribution.id,
      "--if-match",
      current?.etag ?? distribution.etag,
    ],
    `aws cloudfront delete-distribution ${distribution.id}`,
    10 * 60_000,
  );

  const keys = await deleteKeyGroups(ctx, distribution.keyGroups);
  return keys.length
    ? `the distribution ${distribution.id} deleted, with its key group and key ${keys.join(", ")}`
    : `the distribution ${distribution.id} deleted`;
}

/** The key groups a deleted distribution trusted, and the keys inside them. */
async function deleteKeyGroups(ctx: StepContext, ids: string[]): Promise<string[]> {
  const deleted: string[] = [];

  for (const id of ids) {
    const group = await awsJson<{
      ETag?: string;
      KeyGroup?: { KeyGroupConfig?: { Items?: string[] } };
    }>(["cloudfront", "get-key-group", "--id", id], {
      profile: ctx.profile,
      region: ctx.region,
      optional: true,
    }).catch(() => null);
    if (!group?.KeyGroup) continue;

    await awsRun(
      ctx,
      ["cloudfront", "delete-key-group", "--id", id, "--if-match", group.ETag ?? ""],
      `aws cloudfront delete-key-group ${id}`,
    );

    for (const keyId of group.KeyGroup.KeyGroupConfig?.Items ?? []) {
      const key = await awsJson<{ ETag?: string }>(["cloudfront", "get-public-key", "--id", keyId], {
        profile: ctx.profile,
        region: ctx.region,
        optional: true,
      }).catch(() => null);
      if (!key?.ETag) continue;

      try {
        await awsRun(
          ctx,
          ["cloudfront", "delete-public-key", "--id", keyId, "--if-match", key.ETag],
          `aws cloudfront delete-public-key ${keyId}`,
        );
        deleted.push(keyId);
      } catch (error) {
        // A key a *second* key group also lists cannot be deleted, and that
        // group is not this environment's. Reported rather than failed: every
        // resource the environment owned is gone by the time this runs, and
        // stopping the run here would leave the rest of the delete undone over
        // something it never had.
        noteLeft(
          ctx,
          `the CloudFront public key ${keyId} is still trusted by another key group — ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return deleted;
}

/* ------------------------------------------------------------------ *
 * Secrets, and the record a delete keeps of what it did not remove
 * ------------------------------------------------------------------ */

/**
 * The parameter names this stage's delete removes, and the ones it only reports.
 *
 * Split rather than one list because they are two different things. A pair whose
 * names this stage's config *derives* is this stage's: it was created for this
 * environment and the Checklist creates it again. The shared `/play/cloudfront/*`
 * pair is what a stage that **imported** its distribution points at — it is the
 * pair that distribution was created against, older than this repository, and
 * deleting it would take URL signing away from whatever else reads it, which
 * nothing in this repository can enumerate. So it is reported and left alone,
 * which is the same answer `signingKeyState` gives about it everywhere else.
 */
function secretParameters(stage: string): { mine: string[]; shared: string[] } {
  const key = signingKeyParams(stage);
  const idParam = readConfig(stage)?.cloudFrontPublicKeyIdParam ?? defaultCloudFrontPublicKeyIdParam(stage);

  return key.own
    ? { mine: [key.privateParam, key.publicParam, idParam], shared: [] }
    : { mine: [idParam], shared: [key.privateParam, key.publicParam] };
}

/**
 * One report line for a signing key parameter a delete leaves where it is.
 *
 * Plain text rather than prose with markdown in it: these lines are drawn in the
 * deleted-environment card as they arrive, not rendered.
 */
function sharedKeyLine(name: string): string {
  return (
    `${name} is part of the shared signing key pair — the one the distribution this environment ` +
    "imports was created against — so it stays where it is."
  );
}

/** Which of these parameter names exist. Names only: no value is ever read. */
async function parameterNames(ctx: StepContext, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];

  const answer = await awsJson<{ Parameters?: string[] }>(
    [
      "ssm",
      "get-parameters",
      "--names",
      ...names,
      // No `--with-decryption`: a `SecureString`'s name is all this needs, and the
      // private key never crosses into this process.
      "--query",
      "{Parameters: Parameters[].Name}",
    ],
    { profile: ctx.profile, region: ctx.region, optional: true },
  ).catch(() => null);

  return answer?.Parameters ?? [];
}

async function googleSecretExists(ctx: StepContext): Promise<boolean> {
  const answer = await awsJson<{ Name?: string }>(
    ["secretsmanager", "describe-secret", "--secret-id", googleClientSecretName(ctx.stage)],
    { profile: ctx.profile, region: ctx.region, optional: true },
  ).catch(() => null);

  return Boolean(answer?.Name);
}

/** What a step could not delete, for the last step to report. */
function noteLeft(ctx: StepContext, line: string): void {
  const lines = (ctx.data.left as string[] | undefined) ?? [];
  if (!lines.includes(line)) lines.push(line);
  ctx.data.left = lines;
}

function readLeft(ctx: StepContext): string[] | null {
  return (ctx.data.left as string[] | undefined) ?? null;
}

/**
 * An `aws` call that changes something.
 *
 * `awsJson` is the read half of this file's vocabulary, and it is a `JSON.parse`
 * of whatever came back. A delete answers with nothing at all, so the write half
 * is a plain `exec` with the profile and region on it, and `assertOk` — which is
 * what turns "the CLI said no" into the step's failure rather than a note that
 * claims the work is done.
 */
async function awsRun(
  ctx: StepContext,
  argv: string[],
  what: string,
  timeoutMs = 5 * 60_000,
): Promise<void> {
  const result = await exec(ctx, "aws", [...argv, "--profile", ctx.profile, "--region", ctx.region], {
    timeoutMs,
  });
  assertOk(result, what, timeoutMs);
}

/**
 * A few names and a count, for the one-line note beside a step.
 *
 * The notes are drawn beside a step's title, not in a transcript, and this plan
 * has steps whose resources number twenty-eight — a note that listed every table
 * would be a paragraph with a check box in front of it. The full list is in the
 * transcript: every delete is logged as it runs.
 */
function listNames(names: string[], limit = 3): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

/**
 * Whether this environment's own buckets are free to create.
 *
 * A stage that creates its media gets **generated** bucket names unless its
 * config names them, and a generated name cannot be taken — so the interesting
 * case is a stage that froze one, which is what `staging` did to avoid replacing
 * a bucket full of video. Two things can then be in the way:
 *
 * - **another AWS account holds the name.** S3's namespace is global, so
 *   `play-test-videos` was gone before this repository ever ran; the deploy
 *   fails early validation with "already exists", which reads like a leftover of
 *   ours and is not.
 * - **a bucket outlived the stack that made it.** Every bucket here is
 *   `RemovalPolicy.RETAIN`, so deleting a stage leaves its buckets behind, and
 *   the next deploy of that stage cannot create a bucket that exists. Same
 *   failure, different fix: this one *is* ours.
 */
async function ownedBucketCheck(ctx: StepContext): Promise<CheckOutcome> {
  const config = readConfig(ctx.stage);
  const named: { what: string; bucket: string; field: string }[] = [];
  if (config?.videosBucketName) {
    named.push({ what: "videos", bucket: config.videosBucketName, field: "videosBucketName" });
  }
  if (config?.cloudFrontLogsBucketName) {
    named.push({
      what: "CloudFront logs",
      bucket: config.cloudFrontLogsBucketName,
      field: "cloudFrontLogsBucketName",
    });
  }

  if (named.length === 0) {
    return {
      satisfied: true,
      note: "it creates its own bucket, and CloudFormation names it — a generated name cannot be taken",
    };
  }

  for (const { what, bucket, field } of named) {
    const answer = await bucketAccess(bucket, { profile: ctx.profile, region: ctx.region });

    if (answer.access === "free") continue;

    if (answer.access === "other") {
      return {
        satisfied: false,
        note: `the ${what} bucket '${bucket}' exists in another AWS account — an S3 bucket name is unique across every account, so nothing here can create it. Give this stage a name of its own, or point ${field} at a name that is free`,
      };
    }

    if (answer.access === "unknown") {
      return {
        satisfied: false,
        note: `the ${what} bucket '${bucket}' could not be checked — ${answer.detail}`,
      };
    }

    const stack = await describeStack(`PlayMediaStack-${ctx.stage}`, {
      profile: ctx.profile,
      region: ctx.region,
    });
    if (!stack) {
      return {
        satisfied: false,
        note: `'${bucket}' exists and no stack of this environment owns it — a bucket outlives the stack that created it, and CloudFormation refuses to create one that already exists. Empty and delete it, or leave ${field} out of the config so the next deploy generates a name of its own`,
      };
    }
  }

  return {
    satisfied: true,
    note: `${named.map((entry) => entry.bucket).join(" · ")} — this environment's own`,
  };
}

async function outputsFor(
  ctx: StepContext,
): Promise<Awaited<ReturnType<typeof stageOutputs>> | null> {
  const cached = ctx.data.outputs as Awaited<ReturnType<typeof stageOutputs>> | undefined;
  if (cached?.apiUrl) return cached;
  const fresh = await stageOutputs(ctx.stage, { profile: ctx.profile, region: ctx.region });
  if (fresh.apiUrl) ctx.data.outputs = fresh;
  return fresh;
}

interface Health {
  ok: boolean;
  note: string;
  catalogStatus: number | null;
}

/**
 * The two calls, and what each answer means.
 *
 * `/catalog/courses` needs nothing: no authorizer, no key. It is the only
 * endpoint in this API that a stranger can call and get a 200 from, which makes
 * it the only honest health check there is — everything else either requires a
 * credential or answers 404 by design.
 */
async function callApi(apiUrl: string): Promise<Health> {
  const base = apiUrl.replace(/\/$/, "");
  const catalogUrl = `${base}/catalog/courses`;
  const preflightUrl = `${base}/catalog/courses`;

  let catalogStatus: number | null = null;
  let catalogError: string | null = null;
  try {
    const response = await fetch(catalogUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    catalogStatus = response.status;
  } catch (error) {
    catalogError = (error as Error).message;
  }

  if (catalogError) {
    return {
      ok: false,
      catalogStatus,
      note: `GET /catalog/courses did not answer — ${catalogError}`,
    };
  }
  if (catalogStatus !== 200) {
    return {
      ok: false,
      catalogStatus,
      note: `GET /catalog/courses answered ${catalogStatus}, expected 200`,
    };
  }

  let preflightStatus: number | null = null;
  try {
    const response = await fetch(preflightUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3001",
        "Access-Control-Request-Method": "GET",
      },
      signal: AbortSignal.timeout(15_000),
    });
    preflightStatus = response.status;
  } catch {
    // The preflight is a second opinion, not the verdict: the catalog answered.
  }

  return {
    ok: true,
    catalogStatus,
    note: `GET /catalog/courses → 200${preflightStatus ? ` · preflight → ${preflightStatus}` : ""}`,
  };
}

interface UserPoolSummary {
  LambdaConfig?: { PreSignUp?: string };
  /**
   * How many accounts the pool has, as Cognito's own estimate rather than a
   * count — `ListUsers` would be a paginated read of every account to answer a
   * question the delete's note only needs to be roughly right about.
   */
  EstimatedNumberOfUsers?: number;
}

async function describeUserPool(
  poolId: string,
  ctx: StepContext,
): Promise<UserPoolSummary | null> {
  const result = await run(
    "aws",
    [
      "cognito-idp",
      "describe-user-pool",
      "--user-pool-id",
      poolId,
      "--profile",
      ctx.profile,
      "--region",
      ctx.region,
      "--output",
      "json",
    ],
    { timeoutMs: 30_000 },
  ).catch(() => null);

  if (!result || result.code !== 0) return null;
  try {
    return (JSON.parse(result.stdout) as { UserPool?: UserPoolSummary }).UserPool ?? null;
  } catch {
    return null;
  }
}
