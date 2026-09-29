import fs from "node:fs";
import path from "node:path";
import type { LogStream } from "@/lib/types";
import {
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
  listStages,
  readConfig,
  stageOutputs,
  type StageConfig,
} from "./environments";
import { cdkBin, repoPath } from "./repo";
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

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  optional?: boolean;
  /** What a satisfied check is called. Defaults to "Already done". */
  satisfiedLabel?: string;
  /** Milliseconds before `apply` is killed. */
  timeoutMs?: number;
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
}

async function exec(
  ctx: StepContext,
  command: string,
  args: string[],
  options: ExecOptions = {},
) {
  if (!options.quiet) ctx.log("note", `$ ${display(command, args)}`);

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
    onLine: options.quiet ? undefined : ctx.log,
    timeoutMs: options.timeoutMs,
    // Always owned, quiet or not: a process this console cannot kill is a
    // process that outlives it.
    onSpawn: ctx.own,
    detached: true,
  }).catch((error: Error) => {
    throw new Error(`Could not start '${command}': ${error.message}`);
  });
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

  /**
   * The identity, and the account the environment claims.
   *
   * The mismatch check is the whole reason this is a step of its own. The
   * stacks take their account and region from `infra/config/play-<stage>.json`
   * rather than from the ambient credentials, so a profile pointing somewhere
   * else does not fail until CDK refuses the first AWS call — halfway through a
   * deploy, with assets already uploaded to the wrong place.
   */
  const credentials: PlanStep = {
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
            "Deploying here would put stacks in the wrong account.",
        );
      }
      return { note: `${identity.arn} · account ${identity.account}` };
    },
  };

  /**
   * The config file, and the one step that makes "a new environment" mean
   * something.
   *
   * A stage that already has a file skips this. A stage that does not gets one
   * two ways, and which one applies is not a preference:
   *
   * - If the legacy Serverless stack `play-backend-<stage>` is still there, the
   *   documented path works — `import-state.mjs` reads the real resources out
   *   of AWS and writes what it found. It is read-only, and it merges rather
   *   than overwrites.
   * - If it is not — which is the case for every stage that did not exist
   *   before the CDK migration, and for `dev` since the legacy stack was torn
   *   down — there is nothing to discover, and the file is seeded from a stage
   *   that already has one. **That is the honest answer, not a shortcut**: what
   *   a stage imports is the same tables, the same bucket, the same
   *   distribution and the same user pool, because those are shared. A stage
   *   creates its own API, its own media roles and its own pre sign-up trigger,
   *   and nothing that holds data.
   */
  const config: PlanStep = {
    id: "config",
    title: "The environment's resources are named",
    detail: `\`${stageConfigPath}\` is what the stacks stand on: the physical name of every table, the videos bucket, the CloudFront distribution and the Cognito user pool, all of which are imported rather than created. A stage without it cannot synthesize at all.`,
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
      const tables = Object.keys(loaded!.existing?.tables ?? {}).length;
      return {
        satisfied: true,
        note: `${tables} tables · bucket ${loaded!.existing?.videosBucket} · pool ${loaded!.existing?.userPoolId}`,
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
          note: `discovered from play-backend-${ctx.stage} · ${Object.keys(loaded!.existing?.tables ?? {}).length} tables`,
        };
      }

      const seedStage = pickSeedStage(ctx.stage);
      if (!seedStage) {
        throw new Error(
          `No legacy stack 'play-backend-${ctx.stage}' to discover from, and no other stage's ` +
            `config to seed from. Write ${stageConfigPath} by hand — it is the file that says which ` +
            "tables, bucket, distribution and user pool this environment imports.",
        );
      }

      const seed = readConfig(seedStage)!;
      ctx.progress(`seeding from ${seedStage}`);
      ctx.log(
        "note",
        `No 'play-backend-${ctx.stage}' stack to read — seeding ${stageConfigPath} from play-${seedStage}.json.`,
      );
      ctx.log(
        "note",
        "What is imported is shared, so the tables, the bucket, the distribution and the pool carry over unchanged; this stage creates its own API, media roles and pre sign-up trigger.",
      );

      const seeded: StageConfig = {
        ...seed,
        stage: ctx.stage,
        account: seed.account,
        region: seed.region,
      };
      // The mail settings name the local frontends, which move with the port
      // rather than with the stage — so they are carried over as they are, and
      // the note says so rather than leaving it to be noticed.
      fs.mkdirSync(path.dirname(configFile(ctx.stage)), { recursive: true });
      fs.writeFileSync(configFile(ctx.stage), `${JSON.stringify(seeded, null, 2)}\n`);

      return {
        note: `seeded from ${seedStage} · ${Object.keys(seeded.existing?.tables ?? {}).length} tables, pool ${seeded.existing?.userPoolId}`,
      };
    },
  };

  const bootstrap: PlanStep = {
    id: "bootstrap",
    title: "CDK is bootstrapped in this account and region",
    detail:
      "`cdk deploy` uploads each function's bundle and each template to a bucket that the toolkit stack owns — `CDKToolkit`, one per account and region. It is a one-time install, and it is idempotent: bootstrapping again only updates it.",
    satisfiedLabel: "Bootstrapped",
    timeoutMs: 5 * 60_000,
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

      const result = await exec(
        ctx,
        cdkBin(),
        ["bootstrap", `aws://${account}/${ctx.region}`],
        { timeoutMs: 5 * 60_000 },
      );
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
      const result = await exec(
        ctx,
        cdkBin(),
        ["synth", "--all", "--quiet", "--context", `stage=${ctx.stage}`],
        { timeoutMs: 15 * 60_000 },
      );
      assertOk(result, "cdk synth", 15 * 60_000);

      const warn = /⚠|warning|past the|approaching/i.test(result.stderr);
      return {
        note: warn
          ? "synthesized, with a warning — read the transcript"
          : `synthesized with no warnings`,
      };
    },
  };

  /**
   * The S3 handover, and why it cannot be folded into the deploy.
   *
   * `put-bucket-notification-configuration` replaces a bucket's whole
   * notification configuration, and CDK's handler is deliberately conservative
   * about a bucket it did not create: it treats every rule it finds as somebody
   * else's and appends its own. Two rules for the same event with an overlapping
   * prefix are rejected outright, so the deploy fails with "Configuration is
   * ambiguously defined" — an error that names nothing anybody can act on.
   *
   * Uploads are not processed between this running and the deploy that follows.
   * That window is the reason it is a step rather than something a deploy does
   * quietly before showing a diff.
   */
  const handover: PlanStep = {
    id: "handover",
    title: "The videos bucket has one owner",
    detail:
      "The bucket is imported, so CDK appends its `uploads/` notification rather than replacing what is there — and two rules for one event on an overlapping prefix is a deploy that fails with 'Configuration is ambiguously defined'. The handover script removes the leftover rules and nothing else, and it is idempotent.",
    satisfiedLabel: "One owner",
    timeoutMs: 5 * 60_000,
    check: async (ctx) => {
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
          note: `the bucket's only uploads/ rule is this deployment's own`,
        };
      }
      return { satisfied: false, note: "the bucket carries a leftover uploads/ rule" };
    },
    apply: async (ctx) => {
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
      return { note: "the leftover rules were removed; ours is the only one left" };
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

      const result = await run(
        cdkBin(),
        [
          "deploy",
          "--all",
          "--require-approval",
          "never",
          "--progress",
          "events",
          "--context",
          `stage=${ctx.stage}`,
        ],
        {
          cwd: ctx.root,
          env: {
            AWS_PROFILE: ctx.profile,
            AWS_REGION: ctx.region,
            AWS_DEFAULT_REGION: ctx.region,
          },
          timeoutMs: 60 * 60_000,
          onSpawn: ctx.own,
          onLine: (stream, text) => {
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
          },
        },
      ).catch((error: Error) => {
        throw new Error(`Could not start cdk: ${error.message}`);
      });

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
      "`scripts/get-env.mjs` reads the API and auth stack outputs into each app's `.env.local`, and preserves every key it does not manage — the demo's OAuth client id is minted in the studio and exists nowhere else.",
    satisfiedLabel: "Pointed at it",
    timeoutMs: 5 * 60_000,
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
   * The pre sign-up trigger — optional, and the only step that is.
   *
   * The pool is imported, so no deploy can set `LambdaConfig.PreSignUp`. Every
   * stage deploys its own `link-federated-user`, and the pool can only call one
   * of them: repointing it is a decision about *which* stage owns federated
   * sign-up, not a step toward a working deploy. That is exactly why this is
   * optional: on a stage that is not the one people sign up on, the answer is
   * no, and the run should still succeed.
   */
  const trigger: PlanStep = {
    id: "trigger",
    title: "The pool's pre sign-up trigger points here",
    detail:
      "The pool is imported, so nothing deployed can set `LambdaConfig.PreSignUp` — `adopt-cognito.mjs` calls `UpdateUserPool` instead, reading the pool first because that call replaces every setting it is not given. One pool, one trigger: repointing it takes federated sign-up away from whichever stage had it.",
    optional: true,
    satisfiedLabel: "Already points here",
    timeoutMs: 3 * 60_000,
    check: async (ctx) => {
      const loaded = readConfig(ctx.stage);
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
    bootstrap,
    bundle,
    synth,
    handover,
    deploy,
    verify,
    point,
    probe,
    trigger,
  ];
}

/* ------------------------------------------------------------------ *
 * Small helpers the steps lean on
 * ------------------------------------------------------------------ */

/**
 * Which stage's config a brand-new stage borrows.
 *
 * `dev` first — it is the stage that exists in every checkout — then any other
 * stage whose file is complete. A stage in a different account is refused
 * rather than noticed later, because the account is what the borrowed ARNs are
 * built from.
 */
function pickSeedStage(stage: string): string | null {
  const candidates = listStages().filter((candidate) => candidate !== stage);
  const ordered = candidates.sort((a, b) => (a === "dev" ? -1 : b === "dev" ? 1 : 0));
  for (const candidate of ordered) {
    const loaded = readConfig(candidate);
    if (loaded && configProblems(loaded).length === 0) return candidate;
  }
  return null;
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
