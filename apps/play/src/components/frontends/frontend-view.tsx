"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  PlayIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { useServices } from "@/components/apps/use-services";
import { useShell } from "@/components/console/state";
import { EnvironmentPicker } from "@/components/frontends/environment-picker";
import { VercelDeployCard } from "@/components/frontends/vercel-deploy-card";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip, Dot } from "@/components/ui/chip";
import { EnvTable } from "@/components/ui/env-table";
import { Tabs, useTabParam } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { apiHost, relative } from "@/lib/format";
import { STATUS, frontendOf, isLive } from "@/lib/frontends";
import type {
  AppKey,
  FrontendEnvView,
  LogLine,
  ServiceStatus,
  ServiceView,
  VercelProjectView,
} from "@/lib/types";

/**
 * One frontend: what it reads, where it runs, and what it is saying.
 *
 * The three tabs are the three questions anybody has about a running app, and
 * which one is showing is `?tab=` — the same parameter, and the same hook, as an
 * environment's four tabs, so a reload and a link both land on the view somebody
 * was looking at. What is *not* a tab is the control that decides whether it runs
 * at all: the environment and the start button sit above the strip, because
 * starting the app is the page's subject rather than one of its views, and a
 * button that lives inside the Logs tab is a button you have to know to look for.
 *
 * The frontend itself is not a dropdown here either — it is a URL. The list on
 * `/frontends` is what picks one, and this page is about the one you picked.
 */

const TABS = [
  {
    id: "env" as const,
    label: "Env variables",
    hint: "Every NEXT_PUBLIC_* this app reads, and the stack output each one is a copy of. Next inlines these at build time.",
  },
  {
    id: "deployments" as const,
    label: "Deployments",
    hint: "Where this app is running: locally from here, and on Vercel if the project is connected in Integrations.",
  },
  {
    id: "logs" as const,
    label: "Logs",
    hint: "The dev server's output, straight from the process the console started.",
  },
];

export function FrontendView({ app }: { app: AppKey }) {
  const frontend = frontendOf(app)!;
  const { stage } = useShell();
  // One stream for the page, passed down to the tab that draws the output: the
  // hook opens an `EventSource` per use, and a card and a tab each asking for
  // the same three services would be two connections to say one thing.
  const { services, lines, occupied, pending, error, start, stop } = useServices();
  // The tab is in the URL: `?tab=logs` survives a reload, and it is a link
  // somebody can be sent. Same hook, same parameter as an environment's tabs.
  const { tab, select } = useTabParam(TABS);

  const service = services.find((candidate) => candidate.app === app);
  const status = service?.status ?? "stopped";
  const live = isLive(status);
  // Before the first read, "stopped" is the absence of a fact rather than one —
  // a Start offered in that moment would race the port check on a server that is
  // already up.
  const known = services.length > 0;
  // A dev server started against one environment while the picker says another
  // is the one state worth naming: the next Start would move it, and nothing
  // else on the page says so.
  const drifted = live && service?.stage !== stage;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <Link
          href="/frontends"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          Frontends
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{service?.name ?? frontend.label}</h1>
        <p className="text-muted-foreground text-sm">{service?.blurb ?? frontend.hint}</p>
      </header>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <EnvironmentPicker className="w-full sm:max-w-xs" />

          <div className="flex flex-wrap items-center gap-3">
            <Chip tone={STATUS[status].tone}>
              <Dot tone={STATUS[status].tone} pulse={status === "starting"} />
              {STATUS[status].label}
            </Chip>

            {service ? (
              <a
                href={service.url}
                target="_blank"
                rel="noreferrer"
                title={`Open ${service.url}`}
                className={cn(
                  "border-border/70 inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                  live
                    ? "bg-card hover:bg-accent"
                    : "text-muted-foreground pointer-events-none opacity-50",
                )}
              >
                <span className="font-mono text-xs">:{service.port}</span>
                <ExternalLinkIcon className="size-3.5" />
              </a>
            ) : null}

            {live ? (
              <Button
                variant="danger"
                onClick={() => void stop(app)}
                busy={pending === app}
                icon={<SquareIcon className="size-3.5" />}
              >
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => void start(app, stage)}
                busy={pending === app}
                disabled={!known}
                icon={<PlayIcon className="size-4" />}
              >
                Start on {stage}
              </Button>
            )}
          </div>
        </div>

        <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {live ? (
            <>
              <span>
                against <span className="font-mono">{service?.stage ?? "its .env.local"}</span>
              </span>
              <span className="font-mono">{apiHost(service?.apiUrl)}</span>
            </>
          ) : (
            <span>
              Started from here with {stage}&rsquo;s values in the process environment — nothing on
              disk is rewritten, so <span className="font-mono">.env.local</span> stays as you left
              it.
            </span>
          )}
        </div>

        {drifted ? (
          <p className="text-warn mt-3 text-xs">
            Running against <span className="font-mono">{service?.stage ?? "its .env.local"}</span>{" "}
            — stop and start it to move it.
          </p>
        ) : null}

        {service?.adopted ? (
          <p className="border-border/40 mt-4 border-t pt-3 text-xs leading-relaxed">
            Adopted from an earlier console session — the dev server is still serving on port{" "}
            {service.port}, but its output went with the console that started it. Stop and start it
            again to get the transcript back.
          </p>
        ) : null}

        {service && !live && occupied.includes(service.port) ? (
          <p className="text-warn mt-4 flex items-start gap-2 text-xs">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            Port {service.port} is already in use by something the console did not start.
          </p>
        ) : null}

        {status === "failed" && service?.error ? (
          <p className="text-destructive mt-4 text-xs">{service.error}</p>
        ) : null}

        {error ? <p className="text-destructive mt-4 text-xs">{error}</p> : null}
      </Card>

      <Tabs tabs={TABS} value={tab} onChange={select} />

      {tab === "env" ? <EnvTab app={app} stage={stage} /> : null}
      {tab === "deployments" ? <DeploymentsTab app={app} service={service} stage={stage} /> : null}
      {tab === "logs" ? (
        <LogsTab stage={stage} lines={lines.get(app) ?? []} status={status} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 1 — env variables
 * ------------------------------------------------------------------ */

function EnvTab({ app, stage }: { app: AppKey; stage: string }) {
  const [env, setEnv] = useState<FrontendEnvView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEnv(null);
    setError(null);

    fetch(`/api/frontends/${app}/env?stage=${encodeURIComponent(stage)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { env?: FrontendEnvView; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.env) {
          setError(body.error ?? "The variables could not be read.");
          return;
        }
        setEnv(body.env);
      })
      .catch(() => {
        if (!cancelled) setError("The variables could not be read.");
      });

    return () => {
      cancelled = true;
    };
  }, [app, stage]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeading
          title={`${app} · ${stage}`}
          hint="Derived, not typed. Each of these is a stack output the console hands the app when it starts it — which is why starting an app against an environment rewrites nothing on disk."
        />
        <div className="mt-5">
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : env ? (
            <EnvTable rows={env.rows} />
          ) : (
            <p className="text-muted-foreground text-xs">Reading the deployment…</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeading title="Where this environment's outputs come from" />
        <div className="text-muted-foreground mt-4 flex flex-col gap-2 text-xs leading-relaxed">
          <p>
            <span className="text-foreground/80">NEXT_PUBLIC_ is inlined at build time.</span> Next
            substitutes these while compiling, so on a deployed build the value is frozen into the
            JavaScript a visitor downloads. Changing a project variable does nothing until a
            redeploy — which is what{" "}
            <span className="font-mono">Integrations → Vercel</span> makes visible.
          </p>
          <p>
            <span className="text-foreground/80">The redirect URLs are not here.</span>{" "}
            <span className="font-mono">@play/auth</span> builds them from{" "}
            <span className="font-mono">window.location.origin</span>, which is how one package
            serves two apps on different ports. The origins Cognito accepts are on the pool, not in
            this table.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tab 2 — deployments
 * ------------------------------------------------------------------ */

function DeploymentsTab({
  app,
  service,
  stage,
}: {
  app: AppKey;
  service: ServiceView | undefined;
  stage: string;
}) {
  const [vercel, setVercel] = useState<VercelProjectView | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [reload, setReload] = useState(0);

  // A finished deploy changes what this card should say — the project's
  // variables, its domains and its deployment list all moved — and the run is
  // the only thing that knows when. `reload` is that wake-up.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/vercel", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          vercel?: { connected: boolean; projects: VercelProjectView[] };
        };
        if (cancelled || !body.vercel) return;
        setConnected(body.vercel.connected);
        setVercel(body.vercel.projects.find((project) => project.app === app) ?? null);
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [app, reload]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeading
          title="Locally"
          hint="The console starts these with next dev and hands them this environment's outputs. Nothing on disk is rewritten."
        />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {service ? (
            <>
              <Chip
                tone={
                  service.status === "running"
                    ? "ok"
                    : service.status === "failed"
                      ? "bad"
                      : "muted"
                }
              >
                {service.status}
              </Chip>
              <span className="text-muted-foreground font-mono text-xs">{service.url}</span>
              {service.stage ? (
                <span className="text-muted-foreground text-xs">
                  against <span className="font-mono">{service.stage}</span>
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">against its own .env.local</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground text-xs">Not started.</span>
          )}
          <span className="text-muted-foreground ml-auto text-xs">
            Start and stop it above the tabs.
          </span>
        </div>
      </Card>

      <VercelDeployCard
        key={app}
        app={app}
        stage={stage}
        onFinished={() => setReload((count) => count + 1)}
      />

      <Card>
        <CardHeading
          title="On Vercel"
          hint="What is on the project now — the variables it would build with, the domains it answers on, and what it last deployed."
        />

        {connected === false ? (
          <p className="text-muted-foreground mt-4 text-xs">
            Not connected. Add a token in{" "}
            <span className="text-foreground/80">Integrations → Vercel</span> to see this app&rsquo;s
            deployments here.
          </p>
        ) : vercel?.found ? (
          <div className="mt-4 flex flex-col">
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 pb-3 text-xs">
              <span className="font-mono">{vercel.name}</span>
              {vercel.rootDirectory ? (
                <span className="font-mono">{vercel.rootDirectory}</span>
              ) : null}
              {vercel.prodUrl ? (
                <a
                  href={vercel.prodUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground/80 underline underline-offset-4"
                >
                  {vercel.prodUrl.replace("https://", "")}
                </a>
              ) : null}
            </div>

            {vercel.domains.length > 0 ? (
              <div className="text-muted-foreground border-border/40 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
                <span className="text-muted-foreground/70 text-xs font-medium tracking-wide uppercase">
                  Domains
                </span>
                {vercel.domains.map((domain) => (
                  <Chip key={domain.name} tone={domain.verified ? "ok" : "warn"} monospace>
                    {domain.name}
                  </Chip>
                ))}
              </div>
            ) : null}

            <p className="text-muted-foreground mt-4 text-xs font-medium tracking-wide uppercase">
              Variables, by target
            </p>
            <div className="mt-2 flex flex-col">
              {vercel.env.length ? (
                vercel.env.map((variable) => (
                  <div
                    key={variable.key}
                    className="border-border/40 flex flex-wrap items-baseline gap-3 border-t py-2 text-xs"
                  >
                    <span className="w-64 shrink-0 font-mono">{variable.key}</span>
                    <code className="min-w-0 flex-1 truncate" title={variable.value ?? ""}>
                      {variable.value ??
                        (variable.type === "sensitive"
                          ? "— sensitive, never returned"
                          : "— stored encrypted, so Vercel will not return it")}
                    </code>
                    <span className="text-muted-foreground shrink-0">
                      {variable.targets.join(", ")}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-xs">
                  No NEXT_PUBLIC_* variables on this project — a build would have no API URL.
                </p>
              )}
            </div>

            <p className="text-muted-foreground mt-6 text-xs font-medium tracking-wide uppercase">
              Recent deployments
            </p>
            <div className="mt-2 flex flex-col">
              {vercel.deployments.map((deployment) => (
                <div
                  key={deployment.id || `${deployment.createdAt}`}
                  className="border-border/40 flex flex-wrap items-baseline gap-3 border-t py-2.5 text-xs"
                >
                  <Chip tone={deploymentTone(deployment.state)} className="shrink-0">
                    {deployment.state}
                  </Chip>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {deployment.createdAt ? relative(deployment.createdAt, Date.now()) : "—"}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {deployment.target ?? "preview"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {deployment.commitMessage ?? deployment.branch ?? "—"}
                    {deployment.commitSha ? (
                      <span className="text-muted-foreground font-mono"> {deployment.commitSha}</span>
                    ) : null}
                  </span>
                  {deployment.url ? (
                    <a
                      href={deployment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground shrink-0 font-mono"
                    >
                      open
                    </a>
                  ) : null}
                </div>
              ))}
              {vercel.deployments.length === 0 ? (
                <p className="text-muted-foreground text-xs">No deployments recorded.</p>
              ) : null}
            </div>
          </div>
        ) : connected === null ? (
          <p className="text-muted-foreground mt-4 text-xs">Reading…</p>
        ) : (
          <p className="text-muted-foreground mt-4 text-xs">
            No project named <span className="font-mono">{vercel?.name}</span> on this Vercel
            account. The name is whatever you chose at import — see{" "}
            <span className="font-mono">docs/deploy.md</span>.
          </p>
        )}
      </Card>
    </div>
  );
}

function deploymentTone(state: string) {
  if (state === "READY") return "ok" as const;
  if (state === "ERROR" || state === "CANCELED") return "bad" as const;
  if (state === "BUILDING" || state === "QUEUED" || state === "INITIALIZING") return "run" as const;
  return "muted" as const;
}

/* ------------------------------------------------------------------ *
 * Tab 3 — logs
 * ------------------------------------------------------------------ */

function LogsTab({
  stage,
  lines,
  status,
}: {
  stage: string;
  lines: LogLine[];
  status: ServiceStatus;
}) {
  const live = isLive(status);

  // No start button here on purpose: it is above the tabs, where it is reachable
  // from every tab rather than only from this one.
  const nothingYet = useCallback(
    () => `Not running. Start it on ${stage} above to point it at that backend without touching .env.local.`,
    [stage],
  );

  return (
    <Card flush className="pb-4">
      <div className="flex items-center gap-3 px-6 pt-6">
        <h2 className="text-base font-semibold tracking-tight">Output</h2>
        <span className="text-muted-foreground text-xs">
          {lines.length ? `${lines.length} lines` : "nothing yet"}
        </span>
        {status === "starting" ? <Chip tone="run">starting</Chip> : null}
      </div>

      <div className="cp-transcript mt-4 max-h-[32rem] overflow-auto px-6">
        {lines.length ? (
          lines.map((line, index) => (
            <div
              key={index}
              className={cn(
                "py-0.5 font-mono text-xs break-all whitespace-pre-wrap",
                line.stream === "err" && "text-destructive/90",
              )}
            >
              {line.text}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground py-2 text-xs">
            {live ? "Waiting for output." : nothingYet()}
          </p>
        )}
      </div>
    </Card>
  );
}
