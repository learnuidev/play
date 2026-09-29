"use client";

import { useEffect, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PlayIcon,
  SquareIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, Dot, type Tone } from "@/components/ui/chip";
import { Transcript } from "@/components/deploy/transcript";
import { useServices } from "@/components/apps/use-services";
import { useShell } from "@/components/console/state";
import { cn } from "@/lib/cn";
import { apiHost, duration } from "@/lib/format";
import type { AppKey, ServiceStatus } from "@/lib/types";

/**
 * The frontends, started against an environment.
 *
 * ## What the selector does, and why the file is not touched
 *
 * Each card picks a stage and the dev server is started with that stage's
 * `NEXT_PUBLIC_*` values in its environment. Next fills in `.env.local` only for
 * keys `process.env` does not already have, so the injected values win and the
 * file on disk is left exactly as it was — which is the property that makes this
 * safe to use while somebody is halfway through editing that file.
 *
 * *"As configured"* is the other half of the same idea: no injection at all, and
 * the app runs against whatever its `.env.local` says.
 */

/** `"local"` is the picker's word for "do not inject anything". */
const LOCAL = "local";

/** What `POST /api/services/<app>` is sent: a stage, or `null` for the file. */
function stageOf(choice: string): string | null {
  return choice === LOCAL ? null : choice;
}

const STATUS: Record<ServiceStatus, { tone: Tone; label: string }> = {
  stopped: { tone: "muted", label: "stopped" },
  starting: { tone: "run", label: "starting" },
  running: { tone: "ok", label: "running" },
  failed: { tone: "bad", label: "failed" },
};

export function AppsView() {
  const { stage, stages, state } = useShell();
  const services = useServices();

  // One selection per card, seeded from the rail and moved with it — so
  // switching environment in the rail changes what a *next* start would use,
  // without yanking a card somebody deliberately pointed somewhere else.
  const [selected, setSelected] = useState<Record<AppKey, string>>({} as Record<AppKey, string>);
  const [open, setOpen] = useState<AppKey | null>(null);

  // The rail is the environment picker for the whole console, so changing it
  // re-points every card. A card can still be moved on its own afterwards; the
  // rail takes them all back the next time it moves, which is the behaviour a
  // single picker on screen the whole time implies.
  useEffect(() => {
    setSelected({ studio: stage, marketplace: stage, demo: stage });
  }, [stage]);

  const anyRunning = services.services.some((service) => service.status !== "stopped");
  const startable = services.services.filter(
    (service) => service.status === "stopped" || service.status === "failed",
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Frontends</h1>
          <p className="text-muted-foreground text-sm">
            Start any of the three against an environment. The values are passed in the process
            environment, so nothing on disk is rewritten and{" "}
            <span className="text-foreground/80">.env.local</span> stays as you left it.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              for (const service of services.services) {
                if (service.status === "stopped") {
                  void services.start(service.app, stageOf(selected[service.app] ?? stage));
                }
              }
            }}
            disabled={startable.length === 0 || services.pending !== null}
            icon={<PlayIcon className="size-3.5" />}
          >
            {startable.length === 0 ? "All three are up" : "Start all against"}{" "}
            {startable.length === 0 ? null : <span className="font-mono">{stage}</span>}
          </Button>
        </div>
      </header>

      {services.error ? (
        <div className="border-destructive/35 bg-destructive/10 text-destructive flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">{services.error}</p>
          <IconButton onClick={services.dismissError} aria-label="Dismiss">
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {services.services.map((service) => {
          const choice = selected[service.app] ?? stage;
          const isOpen = open === service.app;
          const lines = services.lines.get(service.app) ?? [];
          const drifted =
            service.status !== "stopped" && service.stage !== stageOf(choice);

          return (
            <Card key={service.app} className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold tracking-tight">{service.name}</h2>
                    <Chip tone={STATUS[service.status].tone}>
                      <Dot
                        tone={STATUS[service.status].tone}
                        pulse={service.status === "starting"}
                      />
                      {STATUS[service.status].label}
                    </Chip>
                    {service.status === "running" && service.readyAt ? (
                      <span className="text-muted-foreground text-xs">
                        up {duration(Date.now() - service.readyAt)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-1.5 text-sm">{service.blurb}</p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={service.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "border-border/70 inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                      service.status === "running"
                        ? "bg-card hover:bg-accent"
                        : "text-muted-foreground pointer-events-none opacity-50",
                    )}
                  >
                    <span className="font-mono text-xs">:{service.port}</span>
                    <ExternalLinkIcon className="size-3.5" />
                  </a>

                  {service.status === "stopped" || service.status === "failed" ? (
                    <Button
                      variant="primary"
                      onClick={() => void services.start(service.app, stageOf(choice))}
                      busy={services.pending === service.app}
                      icon={<PlayIcon className="size-4" />}
                    >
                      Start
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      onClick={() => void services.stop(service.app)}
                      busy={services.pending === service.app}
                      icon={<SquareIcon className="size-3.5" />}
                    >
                      Stop
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <label className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">Environment</span>
                  <select
                    value={choice}
                    onChange={(event) =>
                      setSelected((current) => ({ ...current, [service.app]: event.target.value }))
                    }
                    disabled={service.status !== "stopped"}
                    className="border-border/70 bg-background/60 focus-visible:ring-ring h-8 rounded-full border px-3 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
                  >
                    <option value={LOCAL}>as configured (.env.local)</option>
                    {stages.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    ))}
                  </select>
                </label>

                {service.status !== "stopped" && drifted ? (
                  <span className="text-warn text-xs">
                    running against{" "}
                    <span className="font-mono">{service.stage ?? "its .env.local"}</span> — stop
                    and start it to move it
                  </span>
                ) : null}

                <span className="text-muted-foreground ml-auto flex items-center gap-2 font-mono text-xs">
                  {service.status === "running" || service.status === "starting"
                    ? apiHost(service.apiUrl)
                    : service.status === "failed"
                      ? "—"
                      : "not started"}
                </span>
              </div>

              {service.adopted ? (
                <p className="text-muted-foreground border-border/40 border-t pt-3 text-xs leading-relaxed">
                  Adopted from an earlier console session — the dev server is still serving on port{" "}
                  {service.port}, but its output went with the console that started it. Stop and
                  start it again to get the transcript back.
                </p>
              ) : null}

              {service.status === "failed" && service.error ? (
                <p className="text-destructive border-destructive/30 border-t pt-3 text-xs">
                  {service.error}
                </p>
              ) : null}

              {services.occupied.includes(service.port) ? (
                <p className="text-warn flex items-start gap-2 text-xs">
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  Port {service.port} is already in use by something the console did not start.
                </p>
              ) : null}

              <div className="border-border/40 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : service.app)}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium transition-colors"
                >
                  {isOpen ? (
                    <ChevronDownIcon className="size-3.5" />
                  ) : (
                    <ChevronRightIcon className="size-3.5" />
                  )}
                  {isOpen ? "Hide output" : "Show output"}
                  {lines.length > 0 ? (
                    <span className="text-muted-foreground/60 font-mono">
                      {lines.length} {lines.length === 1 ? "line" : "lines"}
                    </span>
                  ) : null}
                </button>

                {isOpen ? (
                  <Transcript
                    className="mt-3"
                    compact
                    title={`${service.name} · next dev -p ${service.port}`}
                    hint={
                      service.stage
                        ? `started against '${service.stage}'`
                        : "started against its own .env.local"
                    }
                    lines={lines}
                  />
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="bg-muted/20">
        <p className="text-muted-foreground text-xs leading-relaxed">
          The demo is a third-party OAuth client, not a third surface: it signs in through the
          studio&rsquo;s consent screen, and it needs its own client id registered there —{" "}
          <span className="text-foreground/80">apps/demo/README.md</span> is the document for that.
          {state?.identity ? null : " AWS credentials are not resolving, so no environment can be started."}
          {anyRunning ? "" : " Nothing is running yet."}
        </p>
      </Card>
    </div>
  );
}
