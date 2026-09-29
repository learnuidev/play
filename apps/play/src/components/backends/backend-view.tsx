"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, ExternalLinkIcon, RefreshCwIcon, TerminalIcon } from "lucide-react";

import { ChecklistView } from "@/components/backends/checklist-view";
import { useNameStage, useShell } from "@/components/console/state";
import { DeployView } from "@/components/deploy/deploy-view";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip, Dot } from "@/components/ui/chip";
import { EnvTable } from "@/components/ui/env-table";
import { Picker } from "@/components/ui/picker";
import { Tabs } from "@/components/ui/tabs";
import {
  BACKEND_TABS,
  backendBlurb,
  backendState,
  type BackendTab,
} from "@/lib/backends";
import { apiHost, relative } from "@/lib/format";
import type {
  BackendEnvView,
  BackendFunctionView,
  BackendLogs,
  DeploymentHistoryView,
  EnvironmentView,
} from "@/lib/types";

/**
 * One environment's backend: what went into it and what came out, what has been
 * deployed to it, and what it is saying.
 *
 * The environment is the **path**, not a dropdown. That is the same decision
 * `/frontends/<app>` makes and for the same reasons: a link to one environment's
 * backend can be sent to somebody, the back button returns to the list, and the
 * list keeps saying what every environment is doing while you read about one.
 * The four tabs below are that page's four views, in the order they are asked:
 * **is this environment ready** (Checklist — the things a person supplies), what
 * is in it and what came out (Env variables), what has been deployed to it, and
 * what it is saying.
 *
 * There is deliberately no 404 here, unlike `/frontends/<app>`. The set of
 * frontends is three names the console knows; the set of environments is open,
 * and a stage nobody has configured yet is the one this console most needs a
 * page for — the Deployments tab is how it stops not existing.
 */

export function BackendView({ stage, tab: initialTab }: { stage: string; tab: BackendTab }) {
  const { state } = useShell();
  const nameStage = useNameStage();
  const [tab, setTab] = useState<BackendTab>(initialTab);

  const environment = state?.environments.find((item) => item.stage === stage) ?? null;
  const status = backendState(environment, state?.identity?.account ?? null);
  /** Before the first read, nothing about this environment is known — not even whether it exists. */
  const reading = state === null;

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
              <Dot tone={status.tone} />
              {status.label}
            </Chip>
          )}

          {environment?.apiUrl ? (
            <a
              href={environment.apiUrl}
              target="_blank"
              rel="noreferrer"
              title={`Open ${environment.apiUrl}`}
              className="border-border/70 bg-card hover:bg-accent ml-auto inline-flex h-8 max-w-full items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors"
            >
              <span className="truncate font-mono">{apiHost(environment.apiUrl)}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0" />
            </a>
          ) : null}
        </div>

        <p className="text-muted-foreground text-sm">
          {reading ? "Reading the environment…" : backendBlurb(environment)}
        </p>
      </header>

      <Tabs tabs={BACKEND_TABS} value={tab} onChange={setTab} />

      {tab === "checklist" ? <ChecklistView stage={stage} /> : null}
      {tab === "env" ? (
        <EnvTab stage={stage} environment={environment} reading={reading} />
      ) : null}
      {tab === "deployments" ? <DeploymentsTab stage={stage} /> : null}
      {tab === "logs" ? <LogsTab stage={stage} /> : null}
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

function DeploymentsTab({ stage }: { stage: string }) {
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
      <DeployView stage={stage} embedded />

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

/* ------------------------------------------------------------------ *
 * Tab 3 — logs
 * ------------------------------------------------------------------ */

function LogsTab({ stage }: { stage: string }) {
  const [functions, setFunctions] = useState<BackendFunctionView[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [logs, setLogs] = useState<BackendLogs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (fn?: string) => {
      setLoading(true);
      setError(null);
      const query = fn ? `?function=${encodeURIComponent(fn)}` : "";
      fetch(`/api/backends/${encodeURIComponent(stage)}/logs${query}`, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as {
            functions?: BackendFunctionView[];
            logs?: BackendLogs | null;
            error?: string;
          };
          if (!response.ok) {
            setError(body.error ?? "The logs could not be read.");
            return;
          }
          if (body.functions) setFunctions(body.functions);
          if (body.logs) setLogs(body.logs);
        })
        .catch(() => setError("The logs could not be read."))
        .finally(() => setLoading(false));
    },
    [stage],
  );

  // The function list first, then the default one — an event-driven function,
  // because those are the ones whose silence is invisible everywhere else.
  useEffect(() => {
    setFunctions([]);
    setLogs(null);
    setSelected("");
    load();
  }, [stage, load]);

  useEffect(() => {
    if (selected || functions.length === 0) return;
    const first = functions[0];
    setSelected(first.name);
    load(first.name);
  }, [functions, selected, load]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeading
          title="Function"
          hint={`${functions.length} Lambda${functions.length === 1 ? "" : "s"} in ${stage}. The first few are the event-driven ones.`}
        />

        <div className="mt-5">
          <Picker
            label="CloudWatch log group"
            value={selected}
            onChange={(next) => {
              setSelected(next);
              load(next);
            }}
            options={
              functions.length
                ? functions.map((fn) => ({
                    value: fn.name,
                    label: fn.key,
                    hint: fn.eventDriven ? "event-driven" : undefined,
                  }))
                : [{ value: "", label: "no functions" }]
            }
          />
        </div>

        {logs ? (
          <p className="text-muted-foreground mt-4 font-mono text-xs">{logs.logGroup}</p>
        ) : null}
      </Card>

      {error ? (
        <Card>
          <p className="text-destructive text-sm">{error}</p>
        </Card>
      ) : null}

      <Card flush className="pb-4">
        <div className="flex flex-wrap items-center gap-3 px-6 pt-6">
          <h2 className="text-base font-semibold tracking-tight">Last hour</h2>
          {loading ? <Chip tone="run">reading</Chip> : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto font-mono"
            onClick={() => selected && load(selected)}
            busy={loading}
          >
            refresh
          </Button>
        </div>

        <div className="cp-transcript mt-4 max-h-96 overflow-auto px-6">
          {logs?.events.length ? (
            logs.events.map((event, index) => (
              <div key={`${event.at}-${index}`} className="flex gap-3 py-0.5 font-mono text-xs">
                <span className="text-muted-foreground/70 shrink-0 tabular-nums">
                  {new Date(event.at).toLocaleTimeString()}
                </span>
                <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{event.message}</span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 py-2 text-xs">
              <TerminalIcon className="size-3.5" />
              {logs?.note ?? "Choose a function."}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
