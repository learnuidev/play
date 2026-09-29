import { randomUUID } from "node:crypto";

import type {
  DeployEvent,
  LogLine,
  RunKind,
  RunResult,
  RunView,
  StackSummary,
  StepView,
  VercelDeployResult,
  VercelDeployTarget,
} from "@/lib/types";
import { buildPlan, type PlanStep, type StepContext } from "./plan";
import type { PipedChild } from "./exec";
import { repoRoot } from "./repo";

/**
 * A run, and the transcript that comes out of it.
 *
 * ## One engine, two runs
 *
 * There is a backend run and a frontend run, and they are the same machine: a
 * list of steps, each with a check and an apply, a transcript per step, a
 * cancel, and a result. What differs is what they are about — four
 * CloudFormation stacks, or one app on Vercel — and that is what `RunSpec` is:
 * the steps, plus the two hooks that turn whatever the steps left behind into
 * the run's own answer. Everything else in this file is shared on purpose. A
 * second copy of this store for Vercel would be a second place where a reload
 * loses a running deploy.
 *
 * ## Why this is a singleton, per kind
 *
 * There is one of each at a time, and that is a decision rather than a
 * limitation. Two `cdk deploy --all` runs against one account do not compose:
 * they contend for the same stacks, CloudFormation serialises them anyway, and
 * whichever loses reports the other's half-finished state as a rollback. A
 * console that let you start the second one would be offering a way to make a
 * mess; one that refuses, and names the run already going, is the honest shape.
 *
 * The two kinds are separate locks because they cannot collide: a backend run
 * writes to AWS and a frontend run writes to Vercel, and a staging backend
 * deploy is exactly the thing somebody wants to watch while a frontend build
 * against `dev` finishes.
 *
 * ## Why it lives on `globalThis`
 *
 * Next's dev server re-evaluates a module when the file changes. A run is
 * minutes long, and a module that forgot it existed halfway through would leave
 * a `cdk deploy` running with nobody holding the handle — and no transcript for
 * whoever comes back to the page. So the store hangs off `globalThis`, which
 * Next does not re-evaluate, and a reload finds the run it left.
 */

/** Lines kept per step. A deploy's transcript is read at the end; its head is not. */
const MAX_LINES = 900;

interface InternalRun {
  view: RunView;
  /** stepId → its transcript, in order. */
  transcripts: Map<string, LogLine[]>;
  listeners: Set<(event: DeployEvent) => void>;
  /** Values the steps pass to each other: the identity, the outputs, the stacks. */
  data: Record<string, unknown>;
  /** What turns those values into this run's answer, once it is over. */
  spec: RunSpec;
  child: PipedChild | null;
  cancelled: boolean;
  seq: number;
}

interface Store {
  runs: Record<RunKind, { active: InternalRun | null; latest: InternalRun | null }>;
  /** On the store rather than in a module, so a hot reload cannot double up. */
  cleanupInstalled: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __playConsoleStore: Store | undefined;
}

const store: Store = (globalThis.__playConsoleStore ??= {
  runs: { backend: { active: null, latest: null }, frontend: { active: null, latest: null } },
  cleanupInstalled: false,
});

/**
 * The console does not outlive the deploy it started.
 *
 * `cdk` runs detached, in its own process group, so that cancelling a run can
 * reach the `ts-node` and `esbuild` underneath it. The price of a process group
 * of your own is that it is nobody else's to clean up: a console that exited
 * without this would leave a `cdk deploy` mid-flight, writing to four stacks,
 * with no transcript and nobody holding the handle.
 *
 * A frontend run owns no process — it is HTTP calls — so it has nothing to
 * kill here, and the loop over both kinds is what keeps that a fact about the
 * run rather than an assumption in this function.
 */
function installRunCleanup(): void {
  if (store.cleanupInstalled) return;
  store.cleanupInstalled = true;

  const kill = () => {
    for (const kind of ["backend", "frontend"] as const) {
      const child = store.runs[kind].active?.child;
      if (!child?.pid) continue;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone, or never got a group of its own.
      }
    }
  };

  process.on("exit", kill);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      kill();
      process.exit(0);
    });
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export function currentRun(kind: RunKind = "backend"): RunView | null {
  const runs = store.runs[kind];
  return (runs.active ?? runs.latest)?.view ?? null;
}

export function isRunning(kind: RunKind = "backend"): boolean {
  return store.runs[kind].active !== null;
}

export function runTranscript(kind: RunKind, runId: string, stepId: string): LogLine[] {
  const run = findRun(kind, runId);
  return run ? [...(run.transcripts.get(stepId) ?? [])] : [];
}

function findRun(kind: RunKind, runId: string): InternalRun | null {
  const runs = store.runs[kind];
  if (runs.active?.view.id === runId) return runs.active;
  if (runs.latest?.view.id === runId) return runs.latest;
  return null;
}

/* ------------------------------------------------------------------ *
 * Subscribing
 * ------------------------------------------------------------------ */

/**
 * Everything a late subscriber missed, in order.
 *
 * A browser that reloads mid-deploy — or opens the page while a run is going —
 * has to see the transcript so far, not an empty console that fills in from the
 * next line onwards. This is the run, its steps, and every buffered line, which
 * is exactly what a live listener would have received.
 */
export function backlog(kind: RunKind, runId: string): DeployEvent[] {
  const run = findRun(kind, runId);
  if (!run) return [];
  const events: DeployEvent[] = [{ type: "run", run: run.view, at: Date.now() }];
  for (const step of run.view.steps) {
    for (const line of run.transcripts.get(step.id) ?? []) {
      events.push({ type: "log", stepId: step.id, line });
    }
  }
  return events;
}

export function subscribe(
  kind: RunKind,
  runId: string,
  listener: (event: DeployEvent) => void,
): () => void {
  const run = findRun(kind, runId);
  if (!run) return () => {};
  run.listeners.add(listener);
  return () => {
    run.listeners.delete(listener);
  };
}

function emit(run: InternalRun, event: DeployEvent): void {
  for (const listener of run.listeners) {
    try {
      listener(event);
    } catch {
      // A broken pipe is a browser that closed. It is not a reason to fail a
      // deploy, and the listener removes itself on `close`.
    }
  }
}

/* ------------------------------------------------------------------ *
 * Starting and stopping
 * ------------------------------------------------------------------ */

/**
 * What a run is, beyond its steps.
 *
 * The steps do the work and leave what they learned in `ctx.data`; these hooks
 * are how that becomes the run's answer. They are separate from `execute` so
 * the engine never has to know what a stack or a deployment is.
 */
export interface RunSpec {
  kind: RunKind;
  /** What the run is about, for the refusal a second start gets. */
  subject: string;
  stage: string;
  profile: string;
  region: string;
  steps: PlanStep[];
  /** A frontend run's app, target and domain. Null for a backend run. */
  vercel?: VercelDeployTarget | null;
  /** A backend run's four stacks and the outputs an app needs. */
  result?: (data: Record<string, unknown>) => RunResult | null;
  /** A frontend run's own deployment. */
  deployment?: (data: Record<string, unknown>) => VercelDeployResult | null;
  /** The AWS account the steps acted on, when they learned one. */
  account?: (data: Record<string, unknown>) => string | null;
}

/**
 * The backend's own spec: `buildPlan`, and the outputs the run's result reads.
 *
 * Kept here rather than in `plan.ts` because the spec is the engine's shape and
 * `plan.ts` is deliberately only about AWS.
 */
export interface StartOptions {
  stage: string;
  profile: string;
  region: string;
}

export function startDeploy(options: StartOptions): RunView {
  return startRun({
    kind: "backend",
    subject: `'${options.stage}'`,
    stage: options.stage,
    profile: options.profile,
    region: options.region,
    steps: buildPlan(options.stage),
    result: (data) => {
      const outputs = data.outputs as Outputs | undefined;
      const stacks = data.stacks as StackSummary[] | undefined;
      if (!outputs && !stacks) return null;
      return {
        apiUrl: outputs?.apiUrl ?? null,
        userPoolId: outputs?.userPoolId ?? null,
        userPoolClientId: outputs?.userPoolClientId ?? null,
        cognitoDomain: outputs?.cognitoDomain ?? null,
        googleAuthEnabled: outputs?.googleAuthEnabled ?? false,
        stacks: stacks ?? [],
      };
    },
    account: (data) => (data.identity as { account?: string } | undefined)?.account ?? null,
  });
}

export function startRun(spec: RunSpec): RunView {
  const runs = store.runs[spec.kind];

  if (runs.active) {
    const error = new Error(
      `A ${spec.kind === "backend" ? "deploy" : "frontend deploy"} is already running against ` +
        `${runs.active.view.vercel ? `'${runs.active.view.vercel.app} → ${runs.active.view.stage}'` : runs.active.view.stage}. ` +
        "Wait for it, or stop it.",
    );
    Object.assign(error, { status: 409 });
    throw error;
  }

  const run: InternalRun = {
    view: {
      id: randomUUID(),
      kind: spec.kind,
      stage: spec.stage,
      profile: spec.profile,
      region: spec.region,
      account: null,
      vercel: spec.vercel ?? null,
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      steps: spec.steps.map(toStepView),
      result: null,
      deployment: null,
      error: null,
    },
    transcripts: new Map(),
    listeners: new Set(),
    data: {},
    spec,
    child: null,
    cancelled: false,
    seq: 0,
  };

  installRunCleanup();
  runs.active = run;
  runs.latest = run;

  void execute(run, spec.steps);

  return run.view;
}

export function cancelRun(kind: RunKind, runId: string): boolean {
  const run = store.runs[kind].active;
  if (!run || run.view.id !== runId) return false;
  run.cancelled = true;

  const child = run.child;
  if (child?.pid) {
    // `cdk` is a Node process that spawns `ts-node` for the app, which spawns
    // esbuild. Killing the parent alone leaves the rest of the tree running, so
    // the whole group goes — the child was not detached, so its group is its
    // own pid.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Running
 * ------------------------------------------------------------------ */

function toStepView(step: PlanStep): StepView {
  return {
    id: step.id,
    title: step.title,
    detail: step.detail,
    optional: step.optional ?? false,
    satisfiedLabel: step.satisfiedLabel ?? "Already done",
    status: "pending",
    note: null,
    startedAt: null,
    finishedAt: null,
    droppedLines: 0,
  };
}

/**
 * The plan as the page draws it before anything has run.
 *
 * Built from the same `PlanStep` objects a run uses, so the checklist somebody
 * reads before pressing the button is the checklist they watch afterwards —
 * same steps, same words, same order. A preview maintained separately would be
 * a second description of the plan, and the one thing this app must not do is
 * describe a deploy it is not about to perform.
 */
export function previewSteps(stage: string): StepView[] {
  return buildPlan(stage).map(toStepView);
}

/** The same, for a plan built by something other than `plan.ts`. */
export function stepsOf(steps: PlanStep[]): StepView[] {
  return steps.map(toStepView);
}

function stepOf(run: InternalRun, id: string): StepView {
  const found = run.view.steps.find((step) => step.id === id);
  if (!found) throw new Error(`No step '${id}' in this run.`);
  return found;
}

function emitStep(run: InternalRun, step: StepView): void {
  emit(run, { type: "step", step, at: Date.now() });
}

/**
 * Runs one step's work, with the step's own deadline over it.
 *
 * Every command the plan runs already has a timeout of its own, and this is the
 * second one — the one that covers a step that hangs somewhere *between*
 * commands, or in a call that forgot to pass one. A console whose run can never
 * end is worse than one whose run fails: the failure names the step and leaves
 * the rest of the checklist untouched.
 */
async function guarded<T>(
  run: InternalRun,
  planStep: PlanStep,
  work: () => Promise<T>,
): Promise<T> {
  const limit = planStep.timeoutMs;
  if (!limit) return work();

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const child = run.child;
      if (child?.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      reject(
        new Error(
          `${planStep.title} did not finish within ${Math.round(limit / 60_000)} minutes and was stopped.`,
        ),
      );
    }, limit);
  });

  try {
    return await Promise.race([work(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function execute(run: InternalRun, plan: PlanStep[]): Promise<void> {
  let failure: string | null = null;

  for (const planStep of plan) {
    const step = stepOf(run, planStep.id);

    if (run.cancelled) {
      step.status = "halted";
      emitStep(run, step);
      continue;
    }

    step.status = "running";
    step.startedAt = Date.now();
    emitStep(run, step);

    const context: StepContext = {
      stage: run.view.stage,
      profile: run.view.profile,
      region: run.view.region,
      root: repoRoot(),
      log: (stream, text) => appendLine(run, step, stream, text),
      progress: (note) => {
        step.note = note;
        emitStep(run, step);
      },
      data: run.data,
      own: (child) => {
        run.child = child;
      },
      stopped: () => run.cancelled,
    };

    try {
      // The check first, and it is not a formality: it is what turns half of
      // these steps into a check mark with a reason beside it, instead of a
      // second run of something that was already done.
      const checked = planStep.check
        ? await guarded(run, planStep, () => planStep.check!(context))
        : null;

      if (checked?.satisfied) {
        step.status = "skipped";
        step.note = checked.note;
      } else if (checked && planStep.manual) {
        // Reported, not applied. A step that is somebody's decision stops here
        // with what the check found and the command that would change it in the
        // transcript — which is the difference between a console that informs
        // and one that moves a shared resource behind the operator's back.
        step.status = "manual";
        step.note = checked.note;
        appendLine(run, step, "note", `not ours to decide — ${checked.note}`);
        if (planStep.manualHint) appendLine(run, step, "note", planStep.manualHint(context));
      } else {
        if (checked && !checked.satisfied) {
          step.note = checked.note;
          appendLine(run, step, "note", `not yet — ${checked.note}`);
        }
        const outcome = await guarded(run, planStep, () => planStep.apply(context));
        // A step that did work is passed; one whose tool reported there was
        // nothing to do is skipped, with the reason in its note. That is what
        // makes a second run of an up-to-date environment read as fourteen
        // satisfied steps rather than fourteen ticks for work that never happened.
        step.status = run.cancelled ? "halted" : (outcome.status ?? "passed");
        if (outcome.note) step.note = outcome.note;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      step.note = message;
      appendLine(run, step, "err", message);

      if (run.cancelled) {
        step.status = "halted";
      } else if (planStep.optional) {
        // Optional steps are the ones whose answer may legitimately be "no" —
        // the pre sign-up trigger is the only one. A failure there is a
        // footnote, not a stopped run.
        step.status = "warned";
        appendLine(run, step, "note", "optional — carrying on");
      } else {
        step.status = "failed";
        failure = `${planStep.title} — ${message}`;
      }
    } finally {
      step.finishedAt = Date.now();
      run.child = null;
      emitStep(run, step);
    }

    if (failure) break;
  }

  if (failure) {
    for (const step of run.view.steps) {
      if (step.status === "pending") {
        step.status = "halted";
        emitStep(run, step);
      }
    }
  }

  finish(run, failure);
}

function appendLine(
  run: InternalRun,
  step: StepView,
  stream: LogLine["stream"],
  text: string,
): void {
  run.seq += 1;
  const line: LogLine = { seq: run.seq, at: Date.now(), stream, text };

  let lines = run.transcripts.get(step.id);
  if (!lines) {
    lines = [];
    run.transcripts.set(step.id, lines);
  }
  lines.push(line);
  if (lines.length > MAX_LINES) {
    lines.splice(0, lines.length - MAX_LINES);
    step.droppedLines += 1;
  }

  emit(run, { type: "log", stepId: step.id, line });
}

/** The outputs `stageOutputs` hands a run, as the backend spec reads them. */
interface Outputs {
  apiUrl?: string | null;
  userPoolId?: string | null;
  userPoolClientId?: string | null;
  cognitoDomain?: string | null;
  googleAuthEnabled?: boolean;
}

function finish(run: InternalRun, failure: string | null): void {
  const view = run.view;
  view.finishedAt = Date.now();
  view.error = failure;
  view.status = run.cancelled ? "cancelled" : failure ? "failed" : "succeeded";

  // Built from what the steps left behind rather than tracked beside them, so a
  // run that failed halfway still reports whatever it did get to.
  view.account = run.spec.account?.(run.data) ?? null;
  view.result = run.spec.result?.(run.data) ?? null;
  view.deployment = run.spec.deployment?.(run.data) ?? null;

  const runs = store.runs[run.view.kind];
  runs.active = null;
  runs.latest = run;
  emit(run, { type: "end", run: view, at: Date.now() });
}
