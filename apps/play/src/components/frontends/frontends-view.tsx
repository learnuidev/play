"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  PlayIcon,
  SquareIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { useServices } from "@/components/apps/use-services";
import { useShell } from "@/components/console/state";
import { EnvironmentPicker } from "@/components/frontends/environment-picker";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, Dot } from "@/components/ui/chip";
import { Picker } from "@/components/ui/picker";
import { cn } from "@/lib/cn";
import { apiHost, duration } from "@/lib/format";
import { FRONTENDS, STATUS, isLive, type FrontendChoice } from "@/lib/frontends";
import type { ServiceView } from "@/lib/types";

/**
 * The three frontends, and what each one is doing.
 *
 * ## Why the list is not drawn from the stream
 *
 * Every frontend exists whether or not anything is running, so the rows come
 * from `FRONTENDS` and the stream only fills in the state of each one. A list
 * built from the last `status` event would be empty for the first second and
 * would lose a row the moment that row failed — which is exactly when somebody
 * needs to see it.
 *
 * ## Why the dropdown navigates
 *
 * The detail — a frontend's variables, its deployments, its output — is a page
 * of its own, so choosing one here goes to it rather than swapping this list
 * underneath the control you just used. It says "Open a frontend…" and resets
 * itself for the same reason: it is a way in, not a selection, and a dropdown
 * that stayed on the frontend you last opened would offer a second answer to
 * "which one am I looking at".
 *
 * The environment beside it is the other half of the same thought — it is what
 * a Start in this list would use, and it is the shell's stage, so the rail, this
 * page and the app's own page all point at one environment.
 */
export function FrontendsView() {
  const { stage } = useShell();
  const { services, occupied, pending, error, dismissError, start, stop } = useServices();
  const router = useRouter();
  const [choice, setChoice] = useState("");

  // Before the first read, "stopped" is not a fact about a process — it is the
  // absence of one. A Start offered in that moment would race the port check and
  // come back as "something else is using 3000".
  const known = services.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Frontends</h1>
        <p className="text-muted-foreground text-sm">
          The three apps, and which backend each one is talking to.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Picker
          label="Frontend"
          value={choice}
          onChange={(next) => {
            setChoice(next);
            if (next) router.push(`/frontends/${next}`);
          }}
          options={[{ value: "", label: "Open a frontend…" }, ...FRONTENDS]}
        />
        <EnvironmentPicker />
      </div>

      {error ? (
        <div className="border-destructive/35 bg-destructive/10 text-destructive flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">{error}</p>
          <IconButton onClick={dismissError} aria-label="Dismiss">
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {FRONTENDS.map((frontend) => (
          <FrontendRow
            key={frontend.value}
            frontend={frontend}
            service={services.find((candidate) => candidate.app === frontend.value)}
            stage={stage}
            occupied={occupied}
            pending={pending === frontend.value}
            known={known}
            onStart={() => void start(frontend.value, stage)}
            onStop={() => void stop(frontend.value)}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One row of the list
 * ------------------------------------------------------------------ */

function FrontendRow({
  frontend,
  service,
  stage,
  occupied,
  pending,
  known,
  onStart,
  onStop,
}: {
  frontend: FrontendChoice;
  service: ServiceView | undefined;
  stage: string;
  occupied: number[];
  pending: boolean;
  known: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const status = service?.status ?? "stopped";
  const live = isLive(status);
  const busyWithPort = service ? occupied.includes(service.port) && !live : false;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold tracking-tight">
              <Link
                href={`/frontends/${frontend.value}`}
                className="focus-visible:ring-ring group inline-flex items-center gap-1 rounded-sm hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
              >
                {service?.name ?? frontend.label}
                <ChevronRightIcon className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
              </Link>
            </h2>
            <Chip tone={STATUS[status].tone}>
              <Dot tone={STATUS[status].tone} pulse={status === "starting"} />
              {STATUS[status].label}
            </Chip>
            {status === "running" && service?.readyAt ? (
              <span className="text-muted-foreground text-xs">
                up {duration(Date.now() - service.readyAt)}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {service?.blurb ?? frontend.hint}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {service ? (
            <a
              href={service.url}
              target="_blank"
              rel="noreferrer"
              title={`Open ${service.url}`}
              className={cn(
                "border-border/70 inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                live ? "bg-card hover:bg-accent" : "text-muted-foreground pointer-events-none opacity-50",
              )}
            >
              <span className="font-mono text-xs">:{service.port}</span>
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ) : null}

          {live ? (
            <Button
              variant="danger"
              onClick={onStop}
              busy={pending}
              icon={<SquareIcon className="size-3.5" />}
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={onStart}
              busy={pending}
              disabled={!known}
              icon={<PlayIcon className="size-4" />}
            >
              Start on {stage}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-muted-foreground">
          {live ? (
            <>
              against <span className="font-mono">{service?.stage ?? "its .env.local"}</span>
            </>
          ) : (
            "not started"
          )}
        </span>
        {live ? (
          <span className="text-muted-foreground ml-auto font-mono">
            {apiHost(service?.apiUrl)}
          </span>
        ) : null}
      </div>

      {service?.adopted ? (
        <p className="text-muted-foreground border-border/40 border-t pt-3 text-xs leading-relaxed">
          Adopted from an earlier console session — the dev server is still serving on port{" "}
          {service.port}, but its output went with the console that started it. Stop and start it
          again to get the transcript back.
        </p>
      ) : null}

      {busyWithPort ? (
        <p className="text-warn flex items-start gap-2 text-xs">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          Port {service?.port} is already in use by something the console did not start.
        </p>
      ) : null}

      {status === "failed" && service?.error ? (
        <p className="text-destructive border-destructive/30 border-t pt-3 text-xs">
          {service.error}
        </p>
      ) : null}
    </Card>
  );
}
