"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";

import { ChecklistView } from "@/components/backends/checklist-view";
import { DeployAction } from "@/components/deploy/deploy-action";
import { BACKEND_RUN, useDeploy, type DeployState } from "@/components/deploy/use-deploy";
import { LogsView } from "@/components/backends/logs-view";
import { TablesView } from "@/components/backends/tables-view";
import { useNameStage, useShell } from "@/components/console/state";
import { DeployView } from "@/components/deploy/deploy-view";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip, Dot, Spinner } from "@/components/ui/chip";
import { EnvTable } from "@/components/ui/env-table";
import { Tabs, useTabParam } from "@/components/ui/tabs";
import { BACKEND_TABS, backendBlurb, backendState, runningFor } from "@/lib/backends";
import { apiHost, relative } from "@/lib/format";
import type { BackendEnvView, DeploymentHistoryView, EnvironmentView } from "@/lib/types";

/**
 * One environment's backend: what went into it and what came out, what has been
 * deployed to it, and what it is saying.
 *
 * The environment is the **path**, not a dropdown. That is the same decision
 * `/frontends/<app>` makes and for the same reasons: a link to one environment's
 * backend can be sent to somebody, the back button returns to the list, and the
 * list keeps saying what every environment is doing while you read about one.
 * The five tabs below are that page's five views, in the order they are asked:
 * **is this environment ready** (Checklist — the things a person supplies), what
 * is in it and what came out (Env variables), what has been deployed to it, what
 * it is saying, and what it actually holds (DynamoDB tables — the one view that
 * reads the product's own rows rather than the deployment's account of itself).
 * Which one is showing is `?tab=` — in the URL, so that a reload and a link both
 * land on the same view, and `replace`d rather than `pushed` so the back button
 * still leaves the page rather than walking the strip.
 *
 * There is deliberately no 404 here, unlike `/frontends/<app>`. The set of
 * frontends is three names the console knows; the set of environments is open,
 * and a stage nobody has configured yet is the one this console most needs a
 * page for — the Deployments tab is how it stops not existing.
 */

export function BackendView({ stage }: { stage: string }) {
  const { state, runs, refreshRuns } = useShell();
  const nameStage = useNameStage();
  // The tab lives in the URL rather than in this component: `?tab=logs` is what a
  // reload, the back button and a link somebody is sent all have in common.
  const { tab, select } = useTabParam(BACKEND_TABS);

  const environment = state?.environments.find((item) => item.stage === stage) ?? null;
  const status = backendState(
    environment,
    state?.identity?.account ?? null,
    runningFor(runs, stage)?.action ?? null,
  );
  /** Before the first read, nothing about this environment is known — not even whether it exists. */
  const reading = state === null;
  /** Null when there is nothing worth a line — see `backendBlurb`. */
  const blurb = backendBlurb(environment);
  /** The run going against this environment, in either direction. */
  const running = runningFor(runs, stage);

  /**
   * This environment's run — one instance for the whole page.
   *
   * The header carries the Deploy button, and the Deployments tab draws the run
   * it starts, so the two have to be the *same* run: a hook per component would
   * be two streams, and pressing the button would leave the checklist behind it
   * waiting for a run it never hears about.
   */
  const deploy = useDeploy(BACKEND_RUN, { stage });

  // The environment in the path becomes the environment the rest of the console
  // is looking at — the chip in the bar, and what a frontend would be started
  // against — so reading about `staging` and then opening Frontends does not
  // leave the two halves of the console pointing at different places.
  //
  // `useNameStage` rather than `setStage`: the stage here may be one the
  // repository has never heard of, and naming it is what makes it selectable
  // everywhere else instead of being reset to whatever the shell knew before.
  useEffect(() => {
    nameStage(stage);
  }, [nameStage, stage]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <Link
          href="/backends"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          Backends
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{stage}</h1>
          {/* No chip before the state has been read: "new" is a fact about a
              stage nobody has configured, and saying it during the first fetch
              would say it about every environment. */}
          {reading ? null : (
            <Chip tone={status.tone}>
              {status.running ? <Spinner tone={status.tone} /> : <Dot tone={status.tone} />}
              {status.label}
            </Chip>
          )}

          {/* The environment's Deploy, in the corner — and it is **the same
              control as the deploy page's**, down to the primary variant and the
              label: one component, `DeployAction`, so the two can never drift
              into a small grey button on one screen and the real one on another.

              Pressing it starts the same run and then opens the tab that is the
              deploy page, because that is where a run is read: the checklist,
              the transcript, and the button that would stop it. On that tab the
              header shows nothing — that card below already carries this
              button, and two of them on one screen is one too many. */}
          <div className="ml-auto flex flex-col items-end gap-1">
            <DeployAction
              stage={stage}
              // The press, and then the console's own list of what is running:
              // the chip beside the name comes from that list, and without the
              // nudge it would take its next scheduled read — up to fifteen
              // seconds — to say "deploying" about a run that is already going.
              onDeploy={() => {
                void deploy.start({ stage }).then(() => refreshRuns());
              }}
              busy={deploy.starting}
              disabled={running !== null}
              title={
                running
                  ? `A ${running.action === "destroy" ? "delete" : "deploy"} is already running against ${stage}`
                  : `Deploy ${stage} — the same plan the Deployments tab runs`
              }
            />
            {/* The refusal goes beside the button that produced it. On the
                Deployments tab the page's own banner says the same thing, and
                one sentence twice is worse than once. */}
            {deploy.error && tab !== "deployments" ? (
              <span className="text-destructive max-w-64 text-right text-xs">{deploy.error}</span>
            ) : null}
          </div>
        </div>

        {/* The address of this environment, on its own line under its name
            rather than out at the right: it is what the environment *is* — the
            thing somebody pastes into a client, an `.env` or a bug report — and
            not a control competing with the one button on the page. */}
        {environment?.apiUrl ? (
          <a
            href={environment.apiUrl}
            target="_blank"
            rel="noreferrer"
            title={`Open ${environment.apiUrl}`}
            className="border-border/70 bg-card hover:bg-accent inline-flex h-8 w-fit max-w-full items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors"
          >
            <span className="truncate font-mono">{apiHost(environment.apiUrl)}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" />
          </a>
        ) : null}

        {reading ? (
          <p className="text-muted-foreground text-sm">Reading the environment…</p>
        ) : blurb ? (
          <p className="text-muted-foreground text-sm">{blurb}</p>
        ) : null}
      </header>

      <Tabs tabs={BACKEND_TABS} value={tab} onChange={select} />

      {tab === "checklist" ? <ChecklistView stage={stage} /> : null}
      {tab === "env" ? (
        <EnvTab stage={stage} environment={environment} reading={reading} />
      ) : null}
      {tab === "deployments" ? <DeploymentsTab stage={stage} deploy={deploy} /> : null}
      {tab === "logs" ? <LogsView stage={stage} /> : null}
      {tab === "tables" ? <TablesView stage={stage} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 1 — env variables
 * ------------------------------------------------------------------ */

function EnvTab({
  stage,
  environment,
  reading,
}: {
  stage: string;
  /** Null for a stage the repository has no config file for. */
  environment: EnvironmentView | null;
  /** ...and null for a stage nobody has read yet, which is not the same thing. */
  reading: boolean;
}) {
  const [env, setEnv] = useState<BackendEnvView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configured = environment !== null;

  useEffect(() => {
    // Nothing to read without a config file, and the answer would be a table of
    // empty rows: what this environment needs is the checklist, not its outputs.
    if (reading || !configured) return;

    let cancelled = false;
    setEnv(null);
    setError(null);

    fetch(`/api/backends/${encodeURIComponent(stage)}/env`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { env?: BackendEnvView; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.env) {
          setError(body.error ?? "The environment could not be read.");
          return;
        }
        setEnv(body.env);
      })
      .catch(() => {
        if (!cancelled) setError("The environment could not be read.");
      });

    return () => {
      cancelled = true;
    };
  }, [stage, configured, reading]);

  if (reading) {
    return (
      <Card>
        <p className="text-muted-foreground text-sm">Reading the environment…</p>
      </Card>
    );
  }

  if (!configured) {
    return (
      <Card>
        <CardHeading
          title="No config file yet"
          hint={`${stage} has no infra/config/play-${stage}.json. Nothing has read a config, so there is nothing to show — the Checklist tab is where one is written, and the Deployments tab is where it is deployed.`}
        />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <p className="text-destructive text-sm">{error}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Two tables and no form. The values are *written* on the Checklist tab —
          the same seven fields, one place — and what this tab adds is the
          direction each one travels and who reads it, which is what makes a
          backend's variables different from a frontend's. */}
      <Card>
        <CardHeading
          title="Outputs"
          hint="What the deploy publishes. These are the values the three frontends are handed — a frontend's own variables are just these rows with a different name."
        />
        <div className="mt-5">
          {env ? (
            <EnvTable rows={env.outputs} emptyNote="This environment has not deployed yet." />
          ) : (
            <p className="text-muted-foreground text-xs">Reading the stacks…</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeading
          title="Inputs, as the deploy sees them"
          hint="The same values the Checklist tab writes, listed with where each one is read from and which part of the deployment consumes it."
        />
        <div className="mt-5">
          {env ? (
            <EnvTable rows={env.inputs} />
          ) : (
            <p className="text-muted-foreground text-xs">Reading the config…</p>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 2 — deployments
 * ------------------------------------------------------------------ */

function DeploymentsTab({ stage, deploy }: { stage: string; deploy: DeployState }) {
  const [history, setHistory] = useState<DeploymentHistoryView | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/backends/${encodeURIComponent(stage)}/deployments`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { history?: DeploymentHistoryView };
        if (body.history) setHistory(body.history);
      })
      .catch(() => {
        // A missing history is not a broken page; the checklist still works.
      })
      .finally(() => setLoading(false));
  }, [stage]);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-6">
      {/* The checklist is the console's whole reason for existing, so it is
          rendered here rather than summarised — this tab *is* the deploy page,
          and the environment it runs against is the one in the URL. */}
      <DeployView stage={stage} deploy={deploy} embedded />

      <Card>
        <CardHeading
          title="What CloudFormation has done"
          hint="Read from the stacks themselves, not from this process — so it survives the console restarting, and it goes back further than the last thing you ran."
          action={
            <IconButton onClick={load} title="Refresh" aria-label="Refresh">
              <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            </IconButton>
          }
        />

        {history?.note ? (
          <p className="text-muted-foreground mt-4 text-xs">{history.note}</p>
        ) : null}

        <div className="mt-4 flex flex-col">
          {(history?.events ?? []).slice(0, 30).map((event, index) => (
            <div
              key={`${event.at}-${index}`}
              className="border-border/40 flex items-baseline gap-3 border-t py-2.5 text-xs first:border-t-0"
            >
              <span className="text-muted-foreground w-20 shrink-0 tabular-nums">
                {relative(event.at, Date.now())}
              </span>
              <Chip tone={statusTone(event.status)} className="shrink-0">
                {event.status}
              </Chip>
              <span className="min-w-0 flex-1">
                <span className="font-mono">{event.resource ?? event.stack}</span>
                {event.reason ? (
                  <span className="text-muted-foreground"> — {event.reason}</span>
                ) : null}
              </span>
            </div>
          ))}
          {!loading && (history?.events ?? []).length === 0 && !history?.note ? (
            <p className="text-muted-foreground text-xs">Nothing has been deployed here yet.</p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function statusTone(status: string) {
  if (status.endsWith("_FAILED")) return "bad" as const;
  if (status.includes("ROLLBACK")) return "warn" as const;
  if (status.endsWith("_COMPLETE")) return "ok" as const;
  if (status.endsWith("_IN_PROGRESS")) return "run" as const;
  return "muted" as const;
}
