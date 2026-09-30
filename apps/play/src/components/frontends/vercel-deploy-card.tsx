"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  RocketIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { StepList } from "@/components/deploy/step-list";
import { Transcript } from "@/components/deploy/transcript";
import { FRONTEND_RUN, useDeploy } from "@/components/deploy/use-deploy";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CopyRow } from "@/components/ui/copy-row";
import { Field, TextInput } from "@/components/ui/field";
import { Picker } from "@/components/ui/picker";
import { Prose } from "@/components/ui/prose";
import { cn } from "@/lib/cn";
import { duration, relative } from "@/lib/format";
import { suggestDomain, vercelAppOf } from "@/lib/frontends";
import type {
  AppKey,
  RunStatus,
  StepView,
  VercelDeployPreview,
  VercelDeployResult,
  VercelDeployTarget,
  VercelTarget,
} from "@/lib/types";

/**
 * Deploying one frontend to Vercel.
 *
 * ## The three questions, and why they are three
 *
 * - **Environment** — *which backend*. It comes from the page's own picker, the
 *   same one the Start button above the tabs uses, because "which environment is
 *   this app pointed at" is one question the whole console shares.
 * - **Target** — *where in Vercel*. Three values, and they are the three a
 *   project resolves its variables against while building.
 * - **Domain** — *what it answers on*. Prefilled from the environment and the
 *   app, editable, and skippable.
 *
 * Environment and target look like one question and are not, which is exactly
 * why the form asks for both: `staging`'s API URL written to the `preview` target
 * is the whole point of having a staging frontend, and a form that assumed they
 * matched could not express it.
 *
 * ## Why a checklist and not a button
 *
 * Because `NEXT_PUBLIC_*` is inlined at build time. Writing the variables changes
 * nothing a visitor sees until the app is rebuilt, the rebuild is what makes them
 * real, and a build takes a couple of minutes and fails in ways only its own
 * output explains. The plan is on screen before the button is pressed — with what
 * it would write — and the transcript underneath is what the build says.
 */

const TARGETS: ReadonlyArray<{ value: VercelTarget; label: string; hint: string }> = [
  { value: "production", label: "Production", hint: "the project's live deployment" },
  { value: "preview", label: "Preview", hint: "a branch build, on its own URL" },
  { value: "development", label: "Development", hint: "no build — read locally by vercel dev" },
];

export function VercelDeployCard({
  app,
  stage,
  onFinished,
}: {
  app: AppKey;
  stage: string;
  /** Told when a run settles, so the page can re-read what Vercel now says. */
  onFinished?: () => void;
}) {
  const deployed = vercelAppOf(app);
  // Scoped to this app: a frontend run belongs to one Vercel project, so studio
  // and marketplace can be building at the same time.
  const deploy = useDeploy(FRONTEND_RUN, { app });

  const [target, setTarget] = useState<VercelTarget>(defaultTarget(stage));
  const [domain, setDomain] = useState(() => suggestDomain(app, stage));
  const [preview, setPreview] = useState<VercelDeployPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  // A different environment is a different deploy: the values, the suggested
  // domain and the target all move with it. Carrying the old ones over would be
  // a form quietly describing the wrong environment while the picker above it
  // says another.
  useEffect(() => {
    setTarget(defaultTarget(stage));
    setDomain(suggestDomain(app, stage));
  }, [app, stage]);

  const wanted = useMemo<VercelDeployTarget>(
    () => ({ app, stage, target, domain: domain.trim() || null }),
    [app, stage, target, domain],
  );

  /**
   * The checklist, and what it would write.
   *
   * Debounced because the domain is typed into: each read is a stack describe
   * plus two Vercel calls, and one per keystroke would be a form that fights the
   * person filling it in. Half a second is longer than a paused typist and
   * shorter than anybody notices.
   */
  useEffect(() => {
    let cancelled = false;
    setReading(true);

    const timer = setTimeout(() => {
      const query = new URLSearchParams({ app, stage, target });
      if (wanted.domain) query.set("domain", wanted.domain);

      fetch(`/api/vercel/deploy?${query}`, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as { preview?: VercelDeployPreview; error?: string };
          if (cancelled) return;
          if (!response.ok || !body.preview) {
            setReadError(body.error ?? "The deployment could not be planned.");
            setPreview(null);
            return;
          }
          setReadError(null);
          setPreview(body.preview);
        })
        .catch(() => {
          if (!cancelled) setReadError("The deployment could not be planned.");
        })
        .finally(() => {
          if (!cancelled) setReading(false);
        });
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [app, stage, target, wanted.domain]);

  // A run belongs to the page it was started from: one against another app or
  // another environment is reported rather than drawn as if it were this one.
  const run = deploy.run;
  const mine =
    run && run.vercel?.app === app && run.vercel.stage === stage ? run : null;
  const elsewhere = run && !mine ? run : null;
  const running = mine?.status === "running";

  const steps: StepView[] = mine ? mine.steps : (preview?.steps ?? []);
  const selected = steps.find((step) => step.id === deploy.selected) ?? null;
  const lines = deploy.selected ? (deploy.lines.get(deploy.selected) ?? []) : [];

  const settled = steps.filter((step) =>
    ["passed", "skipped", "warned", "manual"].includes(step.status),
  ).length;

  const start = useCallback(() => {
    void deploy.start({ app, stage, target, domain: domain.trim() || null });
  }, [app, deploy, stage, target, domain]);

  // The page's other cards read Vercel once when they mount, and a deploy moves
  // every fact they hold. This is the one moment they have to be read again, and
  // it is a fact the run knows and they do not.
  //
  // Through a ref rather than the prop: the caller writes the callback inline, so
  // its identity changes every render, and an effect that depended on it would
  // call back on each one — which is a reload loop, not a refresh.
  const notify = useRef(onFinished);
  notify.current = onFinished;
  const finished = mine && mine.status !== "running" ? mine.finishedAt : null;
  useEffect(() => {
    if (finished) notify.current?.();
  }, [finished]);

  if (!deployed) return null;

  return (
    <Card className="pb-4">
      <CardHeading
        title="Deploy to Vercel"
        hint={`${deployed.name} builds ${deployed.rootDirectory} from this repository. This writes ${stage}'s values to the project, puts it on a domain, and builds it.`}
        action={
          preview?.project ? (
            <Chip tone={preview.project.found ? "ok" : "bad"}>
              {preview.project.found ? "project found" : "no project"}
            </Chip>
          ) : null
        }
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Picker
          label="Vercel environment"
          value={target}
          onChange={setTarget}
          options={TARGETS}
        />
        <Field
          label="Custom domain"
          htmlFor="vercel-domain"
          hint={
            target === "production"
              ? "A domain on a project follows production, so this is usually the bare one — studio.lets-play.xyz."
              : "A preview build is served here by an alias, which is how staging.studio.lets-play.xyz works. Leave it empty to deploy without one."
          }
        >
          <TextInput
            id="vercel-domain"
            value={domain}
            spellCheck={false}
            placeholder={deployed.domain}
            onChange={(event) => setDomain(event.target.value)}
          />
        </Field>
      </div>

      <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span>
          against <span className="font-mono">{stage}</span>
        </span>
        {preview?.source ? <span>{preview.source}</span> : null}
        {reading && !preview ? <span>reading…</span> : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={start}
          busy={deploy.starting}
          disabled={running || reading || preview?.project?.found === false}
          icon={<RocketIcon className="size-4" />}
        >
          {running
            ? "Deploying…"
            : target === "development"
              ? `Write ${stage}'s values`
              : `Deploy to ${target}`}
        </Button>

        {running ? (
          <Button variant="ghost" onClick={() => void deploy.stop()}>
            Stop
          </Button>
        ) : null}

        {mine && !running ? (
          <span className="text-muted-foreground text-xs">
            {runStatusText(mine.status)} ·{" "}
            {relative(mine.finishedAt ?? mine.startedAt, Date.now())}
          </span>
        ) : null}

        {steps.length > 0 ? (
          <Chip
            tone={running ? "run" : settled === steps.length ? "ok" : "muted"}
            monospace
            className="ml-auto"
          >
            {settled} / {steps.length}
          </Chip>
        ) : null}
      </div>

      {readError || deploy.error || preview?.note ? (
        <p className="text-destructive mt-4 flex items-start gap-2 text-xs leading-relaxed">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{deploy.error ?? readError ?? preview?.note}</span>
        </p>
      ) : null}

      {preview?.project?.found === false ? (
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          No project named <span className="font-mono">{deployed.name}</span> on this Vercel
          account. Import the repository once with Root Directory{" "}
          <span className="font-mono">{deployed.rootDirectory}</span> —{" "}
          <span className="font-mono">docs/deploy.md</span> has the three settings. The console
          writes variables to a project; it does not create one.
        </p>
      ) : null}

      {elsewhere ? (
        <p className="text-muted-foreground mt-4 text-xs">
          A deploy of{" "}
          <span className="font-mono">
            {elsewhere.vercel?.app} → {elsewhere.vercel?.target}
          </span>{" "}
          is going. One at a time — wait for it, or stop it from{" "}
          <span className="font-mono">/frontends/{elsewhere.vercel?.app}</span>.
        </p>
      ) : null}

      {target === "development" ? (
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          Vercel has three variable targets and two deployment targets: a build is either
          production or preview. <span className="text-foreground/80">Development</span> is what{" "}
          <span className="font-mono">vercel dev</span> and{" "}
          <span className="font-mono">vercel env pull</span> read on a laptop, so this writes the
          values and builds nothing.
        </p>
      ) : null}

      {preview?.variables.length && !mine ? (
        <div className="mt-5 border-border/40 border-t pt-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            What this would write to {target}
          </p>
          <div className="mt-2 flex flex-col">
            {preview.variables.map((variable) => {
              const current = preview.project?.env.find(
                (existing) =>
                  existing.key === variable.key && existing.targets.includes(target),
              );
              // Three answers, not two: a variable Vercel will not return is not
              // the same as one that differs, and calling it "differs" would be
              // the form claiming to know something it cannot read.
              const state = !current
                ? "not set"
                : current.value === null
                  ? "encrypted"
                  : current.value === variable.value
                    ? "already set"
                    : "differs";
              return (
                <div
                  key={variable.key}
                  className="border-border/40 flex flex-wrap items-baseline gap-3 border-t py-2 text-xs first:border-t-0"
                >
                  <span className="w-64 shrink-0 truncate font-mono" title={variable.key}>
                    {variable.key}
                  </span>
                  <code className="min-w-0 flex-1 truncate" title={variable.value ?? ""}>
                    {variable.value ?? "—"}
                  </code>
                  <Chip
                    tone={state === "already set" ? "muted" : "warn"}
                    className="shrink-0"
                    title={
                      state === "encrypted"
                        ? "Vercel stores this one encrypted, so its current value cannot be read back — it will be rewritten as plain text."
                        : undefined
                    }
                  >
                    {state}
                  </Chip>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {steps.length > 0 ? (
        <>
          <div className="bg-muted mt-6 h-1 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                mine?.status === "failed" ? "bg-destructive" : settled === steps.length ? "bg-ok" : "bg-run",
              )}
              style={{ width: `${steps.length ? (settled / steps.length) * 100 : 0}%` }}
            />
          </div>

          <div className="mt-3">
            <StepList
              steps={steps}
              selected={deploy.selected}
              onSelect={(stepId) => deploy.select(stepId)}
            />
          </div>
        </>
      ) : null}

      {selected ? (
        <div className="mt-5 flex flex-col gap-3">
          <Prose text={selected.detail} className="text-muted-foreground px-1 text-xs" />
          {mine ? (
            <Transcript
              title={selected.title}
              hint={`${selected.id} · step ${steps.findIndex((step) => step.id === selected.id) + 1} of ${steps.length}`}
              lines={lines}
              droppedLines={selected.droppedLines}
              compact
            />
          ) : null}
        </div>
      ) : null}

      {mine?.status === "failed" && mine.error ? (
        <div className="border-destructive/35 bg-destructive/10 mt-5 flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm">
          <TriangleAlertIcon className="text-destructive mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-destructive font-medium">The deploy stopped</p>
            <p className="text-muted-foreground mt-1 font-mono text-xs leading-relaxed">
              {mine.error}
            </p>
          </div>
        </div>
      ) : null}

      {mine?.status === "succeeded" && mine.deployment ? (
        <DeployResult result={mine.deployment} stage={stage} target={target} run={mine} />
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * What came out
 * ------------------------------------------------------------------ */

function DeployResult({
  result,
  stage,
  target,
  run,
}: {
  result: VercelDeployResult;
  stage: string;
  target: VercelTarget;
  run: NonNullable<ReturnType<typeof useDeploy>["run"]>;
}) {
  const total = run.finishedAt ? run.finishedAt - run.startedAt : 0;
  const deployment = result.deployment;
  const written = result.variables.filter((variable) => variable.action !== "unchanged").length;

  return (
    <div className="border-ok/25 bg-ok/6 mt-5 rounded-3xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-ok text-ok-foreground flex size-6 items-center justify-center rounded-full">
            <CheckIcon className="size-3.5" strokeWidth={3} />
          </span>
          <h3 className="text-base font-semibold tracking-tight">
            {deployment ? `${stage} is on ${target}` : `${stage}'s values are written`}
          </h3>
        </div>
        <span className="text-muted-foreground text-xs">
          {written} variable{written === 1 ? "" : "s"} written · {duration(total)}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {deployment?.url ? (
          <CopyRow label="Deployment" value={deployment.url} labelClassName="w-32" />
        ) : null}
        {result.domain ? (
          <CopyRow
            label={result.domain.verified ? "Domain" : "Domain (DNS pending)"}
            value={`https://${result.domain.name}`}
            labelClassName="w-32"
          />
        ) : null}
      </div>

      {deployment?.url ? (
        <a
          href={deployment.url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1.5 text-xs underline underline-offset-4"
        >
          Open the deployment
          <ExternalLinkIcon className="size-3" />
        </a>
      ) : null}

      {result.variables.length > 0 ? (
        <div className="mt-4 border-border/40 border-t pt-3">
          {result.variables
            .filter((variable) => variable.action !== "unchanged")
            .map((variable) => (
              <p key={variable.key} className="py-0.5 font-mono text-xs">
                <span className="text-muted-foreground">{variable.action} </span>
                {variable.key}
                <span className="text-muted-foreground"> = {variable.value}</span>
              </p>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small things
 * ------------------------------------------------------------------ */

/**
 * Which of Vercel's three sets a stage's deploy belongs in.
 *
 * `dev` is the environment the bare domains serve and the one the backend has
 * always been deployed to, so it is production. Every other stage is a *preview*
 * of the same project — which is the fact that makes a second frontend environment
 * possible without a second Vercel project.
 */
function defaultTarget(stage: string): VercelTarget {
  return stage === "dev" ? "production" : "preview";
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
