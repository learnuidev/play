"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCwIcon, TerminalIcon } from "lucide-react";

import { useShell } from "@/components/console/state";
import { DeployView } from "@/components/deploy/deploy-view";
import { SettingsView } from "@/components/settings/settings-view";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EnvTable } from "@/components/ui/env-table";
import { Picker } from "@/components/ui/picker";
import { Tabs } from "@/components/ui/tabs";
import { relative } from "@/lib/format";
import type {
  BackendEnvView,
  BackendFunctionView,
  BackendLogs,
  DeploymentHistoryView,
} from "@/lib/types";

/**
 * A backend, in an environment.
 *
 * There is one backend — the CDK app in `infra/` — and the dropdown exists
 * because "a backend and an environment" is the unit this whole console works
 * in. Naming it means the page says *what* and *where* before it says anything
 * else, and a second backend would be a second entry rather than a second page.
 *
 * The three tabs are the three questions anybody actually has about a deployed
 * backend: what went into it and what came out, what has been deployed to it,
 * and what it is saying.
 */

const BACKENDS = [
  {
    value: "play",
    label: "play",
    hint: "the CDK app in infra/",
  },
] as const;

type BackendKey = (typeof BACKENDS)[number]["value"];
type TabId = "env" | "deployments" | "logs";

const TABS = [
  {
    id: "env" as const,
    label: "Env variables",
    hint: "The inputs a person supplies, and the outputs a deploy publishes — the same values the frontends read.",
  },
  {
    id: "deployments" as const,
    label: "Deployments",
    hint: "The checklist a deploy walks, and what CloudFormation has actually done to this environment.",
  },
  {
    id: "logs" as const,
    label: "Logs",
    hint: "CloudWatch, one function at a time. Event-driven functions first — they are the ones with nowhere else to speak.",
  },
];

export function BackendsView() {
  const { stage, stages, state, environment } = useShell();
  const [backend, setBackend] = useState<BackendKey>("play");
  const [tab, setTab] = useState<TabId>("env");

  const envOptions = useMemo(
    () =>
      (stages.length ? stages : ["dev"]).map((candidate) => {
        const view = state?.environments.find((item) => item.stage === candidate);
        return {
          value: candidate,
          label: candidate,
          hint: view
            ? view.ownsEverything
              ? "its own data"
              : "imported data"
            : "no config yet",
        };
      }),
    [stages, state],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Backends</h1>
        <p className="text-muted-foreground text-sm">
          The API and everything it stands on, one environment at a time.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Picker label="Backend" value={backend} onChange={setBackend} options={BACKENDS} />
        {/* The env dropdown drives the shell's stage, so moving between pages
            keeps the environment you were looking at. */}
        <EnvPicker stage={stage} options={envOptions} />
      </div>

      {environment ? (
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      ) : (
        <Card>
          <CardHeading
            title="No config file yet"
            hint={`${stage} has no infra/config/play-${stage}.json. Deploy it once — the third step writes the file — and this page fills in.`}
          />
        </Card>
      )}

      {environment && tab === "env" ? <EnvTab /> : null}
      {environment && tab === "deployments" ? <DeploymentsTab /> : null}
      {environment && tab === "logs" ? <LogsTab /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 1 — env variables
 * ------------------------------------------------------------------ */

function EnvTab() {
  const { stage } = useShell();
  const [env, setEnv] = useState<BackendEnvView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [stage]);

  if (error) {
    return (
      <Card>
        <p className="text-destructive text-sm">{error}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The inputs half is the Settings form itself, unchanged: it is the
          editable surface, and duplicating it as a table would be a second
          place for the same seven fields to drift. */}
      <SettingsView embedded />

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
          hint="The same values the form above writes, listed with where each one is read from and which part of the deployment consumes it."
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

function DeploymentsTab() {
  const { stage } = useShell();
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
          rendered here rather than summarised — this tab *is* the deploy page. */}
      <DeployView embedded />

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

function LogsTab() {
  const { stage } = useShell();
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

/* ------------------------------------------------------------------ *
 * The environment dropdown
 * ------------------------------------------------------------------ */

function EnvPicker({
  stage,
  options,
}: {
  stage: string;
  options: ReadonlyArray<{ value: string; label: string; hint?: string }>;
}) {
  const { setStage } = useShell();
  return (
    <Picker
      label="Environment"
      value={stage}
      onChange={setStage}
      options={options}
    />
  );
}
