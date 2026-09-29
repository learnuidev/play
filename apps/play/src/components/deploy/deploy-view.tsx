"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  CircleStopIcon,
  TerminalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CopyRow } from "@/components/ui/copy-row";
import { Prose } from "@/components/ui/prose";
import { EnvironmentCard } from "@/components/deploy/environment-card";
import { StepList } from "@/components/deploy/step-list";
import { Transcript } from "@/components/deploy/transcript";
import { useDeploy } from "@/components/deploy/use-deploy";
import { useSettings } from "@/components/settings/use-settings";
import { useShell } from "@/components/console/state";
import { cn } from "@/lib/cn";
import { duration, relative } from "@/lib/format";
import type { RunStatus, StepView } from "@/lib/types";

/**
 * The deploy page.
 *
 * Four things, in the order somebody reads them: what this environment is, the
 * fourteen steps the plan will take and which of them are already satisfied, the
 * transcript of the one being worked on, and — when it is over — what came out
 * of it.
 *
 * The checklist is drawn *before* the button is pressed, from `GET /api/plan`,
 * which builds it from the same `PlanStep` objects the run executes. That is not
 * a nicety: the request behind this feature was a checklist of everything a
 * deployment needs, and a checklist you only see after the fact is a log.
 *
 * **The environment is a prop, not the shell's selection.** The caller is
 * `/backends/<stage>`, where the environment is the URL — and a page that drew
 * another stage's step notes or another stage's stack statuses for the moment it
 * took the shell to catch up would be a page about two environments at once. It
 * matters most for a stage nobody has deployed: that page exists precisely to
 * make it deployable, and drawing the previous environment's data on it would be
 * wrong in the loudest possible way.
 */

export function DeployView({ stage, embedded = false }: { stage: string; embedded?: boolean }) {
  const { state } = useShell();
  const deploy = useDeploy();

  const environment = state?.environments.find((item) => item.stage === stage) ?? null;
  // Whether there is a config file is a fact about the repository, so it is only
  // a fact once the state has been read — before that, saying "no config file
  // yet" would say it about every environment.
  const unknown = state !== null && environment === null;
  const [preview, setPreview] = useState<StepView[] | null>(null);

  const run = deploy.run;
  const isThisStage = run?.stage === stage;

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    void (async () => {
      try {
        const response = await fetch(`/api/plan?stage=${encodeURIComponent(stage)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { steps: StepView[] };
        if (!cancelled) setPreview(body.steps);
      } catch {
        // The checklist is a preview; a page without it still deploys.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  const steps = useMemo<StepView[]>(() => {
    if (isThisStage && run) return run.steps;
    return preview ?? [];
  }, [isThisStage, run, preview]);

  const selected = steps.find((step) => step.id === deploy.selected) ?? null;
  const lines = deploy.selected ? (deploy.lines.get(deploy.selected) ?? []) : [];

  // Read rather than guessed from `ownsEverything`: the question is not whether
  // this environment creates a pool, it is whether one could be built right now.
  const { settings } = useSettings(stage);
  const credentialsNeeded = Boolean(
    settings?.needsGoogleSecret && !settings.googleClientSecretSet,
  );

  // "Settled" rather than "done": a step the console reported instead of doing
  // is finished too — nothing more will happen to it — so it belongs in the
  // count. It carries its own caveat on its own row.
  const settledSteps = steps.filter((step) =>
    ["passed", "skipped", "warned", "manual"].includes(step.status),
  ).length;
  const done = settledSteps;
  const running = run?.status === "running";
  const settled = steps.length > 0 && done === steps.length;

  return (
    <div className="flex flex-col gap-6">
      {embedded ? null : (
        <header className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Deploy</h1>
          <p className="text-muted-foreground text-sm">
            Every step a stage needs, and a check mark for each one that is already satisfied.
            Running it again is safe — that is what the check marks are.
          </p>
        </header>
      )}

      <EnvironmentCard
        stage={stage}
        environment={environment}
        state={state}
        deployable={!running}
        busy={deploy.starting}
        onDeploy={() => void deploy.start({ stage })}
      />

      {unknown ? (
        <p className="text-muted-foreground flex gap-2.5 px-1 text-xs leading-relaxed">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No{" "}
            <code className="text-foreground/80 font-mono">
              infra/config/play-{stage}.json
            </code>{" "}
            yet. The plan&rsquo;s third step writes one — a{" "}
            <span className="text-foreground/80">new environment</span>, with its own tables,
            bucket, distribution and user pool, imported from nowhere and shared with nobody.
          </span>
        </p>
      ) : null}

      {/* A new environment creates its own user pool, and a pool needs a Google
          OAuth client that nothing can discover. Raising it here rather than at
          step 9 is the difference between reading one sentence and reading a
          failed deploy. */}
      {credentialsNeeded ? (
        <div className="border-warn/40 bg-warn/10 flex flex-wrap items-start gap-2.5 rounded-3xl border px-5 py-4 text-xs leading-relaxed">
          <TriangleAlertIcon className="text-warn mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">
            <span className="text-foreground/90 font-medium">
              {stage} has no Google credentials yet.
            </span>{" "}
            <span className="text-muted-foreground">
              It creates its own user pool, so the client id, the secret and the callback URLs have
              to come from somewhere — they are the one thing a deploy cannot discover. Step 8 stops
              on this rather than failing inside Cognito.
            </span>
          </span>
          <Link
            href={`/backends/${encodeURIComponent(stage)}?tab=checklist`}
            className="text-foreground/90 hover:text-foreground shrink-0 font-medium underline underline-offset-4"
          >
            Open the Checklist
          </Link>
        </div>
      ) : null}

      {deploy.error ? (
        <div className="border-destructive/35 bg-destructive/10 text-destructive flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">{deploy.error}</p>
          <IconButton onClick={deploy.dismissError} aria-label="Dismiss">
            <XIcon className="size-3.5" />
          </IconButton>
        </div>
      ) : null}

      <Card className="pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight">Checklist</h2>
          <Chip tone={settled ? "ok" : running ? "run" : "muted"} monospace>
            {done} / {steps.length || 12}
          </Chip>

          <div className="ml-auto flex items-center gap-3">
            {run && !running ? (
              <span className="text-muted-foreground text-xs">
                {runStatusText(run.status)} · {relative(run.finishedAt ?? run.startedAt, Date.now())}
              </span>
            ) : null}
            {running ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => void deploy.stop()}
                icon={<CircleStopIcon className="size-3.5" />}
              >
                Stop
              </Button>
            ) : null}
          </div>
        </div>

        <div className="bg-muted mt-4 h-1 overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              run?.status === "failed" ? "bg-destructive" : settled ? "bg-ok" : "bg-run",
            )}
            style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }}
          />
        </div>

        <div className="mt-3">
          {steps.length === 0 ? (
            <div className="flex flex-col gap-2 py-2" aria-hidden>
              {[0, 1, 2, 3].map((key) => (
                <div key={key} className="bg-muted/40 h-10 animate-pulse rounded-2xl" />
              ))}
            </div>
          ) : (
            <StepList
              steps={steps}
              selected={deploy.selected}
              onSelect={(stepId) => deploy.select(stepId)}
            />
          )}
        </div>

        {run && !isThisStage ? (
          <p className="text-muted-foreground mt-3 border-t border-border/40 pt-3 text-xs">
            These are the steps for <span className="font-mono">{stage}</span>. The last run was
            against <span className="font-mono">{run.stage}</span>, so its results are not shown
            here.
          </p>
        ) : null}
      </Card>

      {selected ? (
        <div className="flex flex-col gap-3">
          <Prose
            text={selected.detail}
            className="text-muted-foreground max-w-3xl px-1 text-xs"
          />
          <Transcript
            title={selected.title}
            hint={`${selected.id} · step ${steps.findIndex((step) => step.id === selected.id) + 1} of ${steps.length}`}
            lines={lines}
            droppedLines={selected.droppedLines}
          />
        </div>
      ) : (
        <Card flush className="flex items-center gap-3 px-6 py-5">
          <TerminalIcon className="text-muted-foreground size-4" />
          <p className="text-muted-foreground text-sm">
            Pick a step to read what it does, and what it printed.
          </p>
        </Card>
      )}

      {run?.status === "failed" && run.error ? (
        <Card className="border-destructive/35 bg-destructive/8">
          <div className="flex items-start gap-3">
            <TriangleAlertIcon className="text-destructive mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-destructive text-base font-semibold tracking-tight">
                The run stopped
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Everything after it is marked <em>not reached</em>: those steps were not attempted,
                and nothing about them is known. Fix what the transcript says, then run the plan
                again — the steps that already passed will report themselves satisfied.
              </p>
              <p className="text-destructive mt-3 font-mono text-xs">{run.error}</p>
            </div>
          </div>
        </Card>
      ) : null}

      {run?.status === "succeeded" && run.result?.apiUrl ? (
        <ResultCard run={run} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * What came out
 * ------------------------------------------------------------------ */

function ResultCard({ run }: { run: NonNullable<ReturnType<typeof useDeploy>["run"]> }) {
  const result = run.result!;
  const total = run.finishedAt ? run.finishedAt - run.startedAt : 0;

  return (
    <Card className="border-ok/25 bg-ok/6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="bg-ok text-ok-foreground flex size-6 items-center justify-center rounded-full">
              <CheckIcon className="size-3.5" strokeWidth={3} />
            </span>
            <h2 className="text-base font-semibold tracking-tight">
              <span className="font-mono">{run.stage}</span> is deployed
            </h2>
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {run.steps.filter((step) => step.status === "passed").length} steps ran,{" "}
            {run.steps.filter((step) => step.status === "skipped").length} were already satisfied, in{" "}
            {duration(total)}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/frontends"
            className="border-border/70 bg-card hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors"
          >
            Start the frontends
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 border-t border-border/40 pt-4">
        {result.apiUrl ? <CopyRow label="API" value={result.apiUrl} /> : null}
        {result.userPoolId ? <CopyRow label="Pool" value={result.userPoolId} /> : null}
        {result.userPoolClientId ? (
          <CopyRow label="Client" value={result.userPoolClientId} />
        ) : null}
        {result.cognitoDomain ? <CopyRow label="Hosted UI" value={result.cognitoDomain} /> : null}
      </div>

      {result.stacks.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {result.stacks.map((stack) => (
            <Chip key={stack.name} tone={stack.healthy ? "ok" : "bad"} monospace title={stack.status}>
              {stack.name}
            </Chip>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function runStatusText(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "stopped";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}
