import type { Tone } from "@/components/ui/chip";
import type { EnvironmentView, RunView } from "@/lib/types";

/**
 * A backend, named once — and the words the console uses about one.
 *
 * There is **one** backend: the CDK app in `infra/`. So "a backend" is only ever
 * *that* app in a stage, and a row in the list is a stage rather than a program.
 * Everything a row says is therefore a fact about four CloudFormation stacks —
 * what they are called, which of them is complete, and whether this stage creates
 * its own data or imports somebody else's.
 *
 * `lib/frontends.ts` is the same file for the other side: the names a page needs
 * before the server has said anything, and the vocabulary for the states they are
 * in. Both are imported from a server component and a client one, so both are
 * JSON and words, with nothing that touches `fs` or a process.
 */

/** Where one environment's backend lives. The list, the picker and every link agree. */
export function backendPath(stage: string): string {
  return `/backends/${encodeURIComponent(stage)}`;
}

/* ------------------------------------------------------------------ *
 * The states a row can be in
 * ------------------------------------------------------------------ */

export interface BackendState {
  tone: Tone;
  label: string;
  /** The console is running a deploy against this environment right now. */
  running: boolean;
}

/**
 * The state of one environment's backend, in one chip.
 *
 * Read from the stacks themselves rather than remembered here, and the same
 * answer on the list and on the environment's own page — a row that said
 * "deployed" above a page that said "partly deployed" would be two answers to
 * one question.
 *
 * **A deploy in flight is the first thing it says**, and it has to be. The stacks
 * of an environment being deployed are exactly the half-built set a "partly
 * deployed" chip describes, so without this the row that says the most alarming
 * possible thing is the one that is working correctly — and it says it about a
 * deploy that has been running for forty seconds. The stack statuses catch up a
 * few seconds after the run ends, which is when this stops applying.
 *
 * `new` is the only state that is about an environment the repository has never
 * heard of, and it is not a verdict: a stage with no config file is the normal
 * state of a stage somebody is about to create.
 */
export function backendState(
  environment: EnvironmentView | null,
  account: string | null,
  deploying = false,
): BackendState {
  if (deploying) return { tone: "run", label: "deploying", running: true };
  if (!environment) return { tone: "muted", label: "new", running: false };
  if (environment.deployed) return { tone: "ok", label: "deployed", running: false };
  if (environment.partial) return { tone: "warn", label: "partly deployed", running: false };
  if (!environment.hasConfig) {
    return { tone: "muted", label: "needs a config file", running: false };
  }
  if (environment.account && account && environment.account !== account) {
    return { tone: "bad", label: "different account", running: false };
  }
  return { tone: "muted", label: "not deployed", running: false };
}

/**
 * The deploy going for one stage, out of everything the console knows is running.
 *
 * Null for a stage nobody is deploying, which is nearly always. A stage can only
 * have one run at a time — `server/run.ts` refuses the second — so the first
 * match is the only match.
 */
export function deployingRun(runs: RunView[], stage: string): RunView | null {
  return runs.find((run) => run.stage === stage && run.status === "running") ?? null;
}

/**
 * What a deploy is doing, in one line, for a row that is not the deploy page.
 *
 * The step it is on and how far it has got, which is the whole of what somebody
 * glancing at the list wants: *which* step is the difference between "it is
 * going" and "it has been stuck on the same thing for ten minutes".
 */
export function deployProgress(run: RunView): string {
  const running = run.steps.findIndex((step) => step.status === "running");
  const pending = run.steps.findIndex((step) => step.status === "pending");
  const at = running >= 0 ? running : pending >= 0 ? pending : run.steps.length - 1;
  const step = run.steps[at];
  return `Deploying — step ${at + 1} of ${run.steps.length}${step ? ` · ${step.title}` : ""}`;
}

/**
 * The one line under a stage's name — on its row, and at the top of its page.
 *
 * The interesting thing about this backend is which of its resources it *owns*,
 * because that is what decides whether a deploy here can change what another
 * environment reads. `dev` imports; a new environment creates. So the sentence
 * leads with the data rather than with the API.
 */
export function backendBlurb(environment: EnvironmentView | null): string {
  if (!environment) {
    return (
      "No config file yet — that is what the plan's third step writes. " +
      "A new environment creates everything: its own tables, bucket and user pool."
    );
  }
  if (environment.ownsEverything) {
    return "Creates everything it stands on — its own tables, videos bucket, distribution and user pool.";
  }

  const imported = [
    environment.tables > 0 ? `${environment.tables} tables` : null,
    environment.ownership?.media === false ? "the videos bucket" : null,
    environment.ownership?.auth === false ? "the user pool" : null,
  ].filter((part): part is string => part !== null);

  return imported.length
    ? `Imports ${listOf(imported)} — shared with every other stage that imports them, so a deploy here points at the same data.`
    : "Imports what it stands on — an imported resource is one a deploy can neither change nor delete.";
}

/** `["a", "b", "c"]` → `a, b and c`. */
function listOf(parts: string[]): string {
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------ *
 * The three views of one environment
 * ------------------------------------------------------------------ */

export type BackendTab = "checklist" | "env" | "deployments" | "logs";

/**
 * Four questions, in the order they are asked: is this environment ready, what
 * is in it and what came out, what has been deployed to it, and what is it
 * saying.
 *
 * **Checklist is first because it is the front door for a new environment** —
 * the things a person has to supply before there is anything to deploy, and the
 * row that says which of them is missing. Env variables is the read-only half of
 * the same picture: the outputs a deploy published and the inputs it read.
 */
export const BACKEND_TABS = [
  {
    id: "checklist",
    label: "Checklist",
    hint: "What this environment needs from a person — its config file, the Google credentials nothing can discover, and the signing key the console generates. A tick is a requirement that is met.",
  },
  {
    id: "env",
    label: "Env variables",
    hint: "The outputs a deploy publishes — the same values the frontends are handed — and the inputs as the deploy reads them. Editable on the Checklist tab.",
  },
  {
    id: "deployments",
    label: "Deployments",
    hint: "The checklist a deploy walks, and what CloudFormation has actually done to this environment.",
  },
  {
    id: "logs",
    label: "Logs",
    hint: "CloudWatch, one function at a time. Event-driven functions first — they are the ones with nowhere else to speak.",
  },
] as const;

/**
 * Which tab a URL asked for.
 *
 * The tab is in the query string because "go straight to the checklist" is a
 * thing worth linking to — a new environment starts there, and the button that
 * names one links to it — and anything unrecognised is the first tab rather than
 * an error.
 */
export function backendTab(value: string | string[] | undefined): BackendTab {
  const wanted = Array.isArray(value) ? value[0] : value;
  const match = BACKEND_TABS.find((tab) => tab.id === wanted);
  return match ? match.id : "checklist";
}
