"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  PlusIcon,
  RocketIcon,
  XIcon,
} from "lucide-react";

import { useNameStage, useShell } from "@/components/console/state";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, Dot, Spinner } from "@/components/ui/chip";
import { Picker } from "@/components/ui/picker";
import {
  backendBlurb,
  backendPath,
  backendState,
  runProgress,
  runningFor,
} from "@/lib/backends";
import { apiHost } from "@/lib/format";
import type { EnvironmentView, RunSummary } from "@/lib/types";

/**
 * The backends: a row per environment, and the one button that starts a new one.
 *
 * ## Why the rows are environments
 *
 * There is one backend — the CDK app in `infra/` — and the plural is only ever
 * about *where* it has been deployed. So a row is "the API, in `dev`", and what
 * it says is what the four stacks say: which are complete, whether this
 * environment creates its own data or imports another's, and where the API is.
 *
 * ## Why the list is not drawn from a stream
 *
 * Every environment exists whether or not anything has been deployed to it, so
 * the rows come from the shell's own list — the config files on disk, plus any
 * stage named in this session — and the state only fills each one in. A list
 * built from the deployed stacks would be empty on a fresh checkout, which is
 * exactly when somebody needs to deploy the first one.
 *
 * ## Why "Deploy to a new backend env" does not deploy
 *
 * "Deploy to a new backend env" asks for a name and then *opens* that
 * environment's page on its **Checklist** tab, because that is what a new
 * environment needs first: a config file, a Google client id and secret for the
 * pool it creates, and a signing key. The first of those is written and the
 * other two are supplied or generated there.
 *
 * ## Why each row has a Deploy on it
 *
 * The row's own button is the same press as the Deployments tab's, one page
 * earlier: the same `POST /api/deploy`, the same plan, the same run — so an
 * environment somebody already knows is ready does not need a page opened to
 * start it. It is deliberately the *small* button, and the Deployments tab is
 * still where the checklist is read before a first deploy: this one is for the
 * fourth deploy of an environment that has been up for months.
 */
export function BackendsView() {
  const { stages, state, loading, runs, refreshRuns } = useShell();
  const router = useRouter();
  const [choice, setChoice] = useState("");

  const account = state?.identity?.account ?? null;

  const rows = useMemo(() => (stages.length ? stages : ["dev"]), [stages]);

  const environmentOf = useMemo(() => {
    const found = new Map<string, EnvironmentView>();
    for (const environment of state?.environments ?? []) found.set(environment.stage, environment);
    return found;
  }, [state]);

  // A stage named here that has never been deployed has no environment yet, and
  // a deploy of it is the one thing this list can say about it — so a stage
  // that is deploying is a row whether or not the state has heard of it.
  const allRows = useMemo(() => {
    const extra = runs.map((run) => run.stage).filter((stage) => !rows.includes(stage));
    return [...rows, ...new Set(extra)];
  }, [rows, runs]);

  // Each option carries the same verdict its row does, so the dropdown can say
  // which environments have an API without the row having to be read.
  const options = useMemo(
    () => [
      { value: "", label: "Open an environment…" },
      ...allRows.map((stage) => {
        const environment = environmentOf.get(stage) ?? null;
        const activity = runningFor(runs, stage)?.action ?? null;
        return {
          value: stage,
          label: stage,
          hint: loading ? "reading…" : backendState(environment, account, activity).label,
        };
      }),
    ],
    [allRows, environmentOf, account, loading, runs],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Backends</h1>
          <p className="text-muted-foreground text-sm">
            One backend — the CDK app in <span className="font-mono">infra/</span> — and every
            environment it has been deployed to.
          </p>
        </div>

        <NewBackend />
      </header>

      {/* A way in, for the same reason the frontends list has one: the
          environment is a route, so this is a link with a keyboard on it rather
          than a selection that changes what the list below is about. */}
      <Picker
        label="Environment"
        value={choice}
        onChange={(next) => {
          setChoice(next);
          if (next) router.push(backendPath(next));
        }}
        options={options}
        className="sm:max-w-sm"
      />

      <div className="flex flex-col gap-4">
        {allRows.map((stage) => (
          <BackendRow
            key={stage}
            stage={stage}
            environment={environmentOf.get(stage) ?? null}
            account={account}
            loading={loading}
            running={runningFor(runs, stage)}
            onStarted={refreshRuns}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One row
 * ------------------------------------------------------------------ */

function BackendRow({
  stage,
  environment,
  account,
  loading,
  running,
  onStarted,
}: {
  stage: string;
  environment: EnvironmentView | null;
  /** The account the console is acting as, so a stage in another one is named. */
  account: string | null;
  /**
   * Before the first read, "not deployed" is the absence of a fact rather than
   * one — and so is every other verdict this row could carry, so it carries none.
   */
  loading: boolean;
  /** The run going against this stage, when there is one — either direction. */
  running: RunSummary | null;
  /** Told when a deploy was accepted, so the list re-reads what is running. */
  onStarted: () => void;
}) {
  const status = backendState(environment, account, running?.action ?? null);
  const stacks = environment?.stacks ?? [];
  const complete = stacks.filter((stack) => stack.healthy).length;

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The same `POST /api/deploy` the Deployments tab makes, and the same plan.
   *
   * A refusal is the server's own sentence — most often that this environment is
   * already deploying, which is also the state the button is disabled in, so it
   * is mostly the race between two tabs. It is shown here rather than swallowed:
   * a button that does nothing and says nothing is the worst of the three.
   */
  const deploy = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `The deploy could not start (HTTP ${response.status}).`);
        return;
      }
      onStarted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }, [stage, onStarted]);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold tracking-tight">
              <Link
                href={backendPath(stage)}
                className="focus-visible:ring-ring group inline-flex items-center gap-1 rounded-sm font-mono hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
              >
                {stage}
                <ChevronRightIcon className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
              </Link>
            </h2>
            {loading ? null : (
              <Chip tone={status.tone}>
                {status.running ? <Spinner tone={status.tone} /> : <Dot tone={status.tone} />}
                {status.label}
              </Chip>
            )}
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {loading ? "Reading the environment…" : backendBlurb(environment)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {environment?.apiUrl ? (
            <a
              href={environment.apiUrl}
              target="_blank"
              rel="noreferrer"
              title={`Open ${environment.apiUrl}`}
              className="border-border/70 bg-card hover:bg-accent inline-flex h-8 max-w-full items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors"
            >
              <span className="truncate font-mono text-xs">{apiHost(environment.apiUrl)}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0" />
            </a>
          ) : null}

          {/* The row's Deploy: the same press as the Deployments tab's, one page
              earlier. Disabled, not hidden, while a run is going — the chip
              beside the name is what says why. Its label follows the run that is
              going, because "Deploying" over a delete would be a lie about
              somebody's environment. */}
          <Button
            variant="secondary"
            size="sm"
            busy={starting}
            disabled={status.running}
            onClick={() => void deploy()}
            icon={<RocketIcon className="size-3.5" />}
            title={
              status.running
                ? `A ${running?.action === "destroy" ? "delete" : "deploy"} is already running against ${stage}`
                : `Deploy ${stage} — the same plan the Deployments tab runs`
            }
          >
            {running?.action === "destroy" ? "Deleting" : status.running ? "Deploying" : "Deploy"}
          </Button>
        </div>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {/* A run in flight is the one thing this line should say: the stack
            count below it is the half-built set the run is in the middle of
            producing, which reads as a warning about work that is going fine. */}
        {running ? (
          <>
            <span className="text-foreground/80">{runProgress(running)}</span>
            <Link
              href={`${backendPath(stage)}?tab=deployments`}
              className="text-foreground/80 hover:text-foreground inline-flex items-center gap-1 font-medium underline underline-offset-4"
            >
              Watch it
              <ChevronRightIcon className="size-3" />
            </Link>
          </>
        ) : (
          <span>
            {loading
              ? "Reading the stacks…"
              : stacks.length === 0
                ? "No stacks yet."
                : `${complete} of ${stacks.length} stacks complete.`}
          </span>
        )}
        {environment?.account ? (
          <span className="ml-auto font-mono">
            {environment.account} · {environment.region}
          </span>
        ) : null}
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Deploy to a new backend env
 * ------------------------------------------------------------------ */

/**
 * The name, and then the checklist.
 *
 * The stage is only *named* here. What makes it real is the deploy page's third
 * step — which writes `infra/config/play-<stage>.json`, as a new environment with
 * its own tables, bucket, distribution and user pool — and the reason this hands
 * over to that page rather than starting a run is that the plan is written down
 * precisely so it can be read first.
 */
function NewBackend() {
  const nameStage = useNameStage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const stage = value.trim().toLowerCase();
  const valid = /^[a-z0-9][a-z0-9-]{0,30}$/.test(stage);

  if (!open) {
    return (
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        icon={<PlusIcon className="size-4" />}
      >
        Deploy to a new backend env
      </Button>
    );
  }

  const close = () => {
    setOpen(false);
    setValue("");
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        // The environment in the URL is the one the rest of the console then
        // reads, so the page it opens adopts the name itself.
        nameStage(stage);
        router.push(`${backendPath(stage)}?tab=checklist`);
      }}
      className="flex w-full flex-col gap-2 sm:max-w-md"
    >
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          placeholder="staging"
          aria-label="New environment name"
          className="border-border/70 bg-background/60 focus-visible:ring-ring h-10 min-w-0 flex-1 rounded-full border px-4 font-mono text-sm focus-visible:ring-2 focus-visible:outline-none sm:w-56 sm:flex-none"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!valid}
          icon={<ChevronRightIcon className="size-4" />}
        >
          Open the checklist
        </Button>
        <IconButton type="button" onClick={close} aria-label="Cancel" title="Cancel">
          <XIcon className="size-3.5" />
        </IconButton>
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        Nothing runs yet. This opens{" "}
        <span className="font-mono text-foreground/80">{stage || "the new environment"}</span>
        &rsquo;s checklist, which asks for the Google credentials the pool it creates is built
        with, and writes{" "}
        <span className="font-mono text-foreground/80">
          infra/config/play-{stage || "<stage>"}.json
        </span>
        .
      </p>
    </form>
  );
}
