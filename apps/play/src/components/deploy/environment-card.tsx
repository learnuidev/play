"use client";

import { RocketIcon, ShieldAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, Dot, type Tone } from "@/components/ui/chip";
import { backendState } from "@/lib/backends";
import { cn } from "@/lib/cn";
import { apiHost, stackInitials, stackWord } from "@/lib/format";
import type { ConsoleState, EnvironmentView, StackSummary } from "@/lib/types";

/**
 * The environment, and the one button.
 *
 * Everything the deploy is about, on one card: which stage, which account it
 * will land in, the four stacks and where each of them is, and what a deploy
 * here can and cannot touch. That last part is a paragraph rather than a
 * footnote on purpose — the surprising thing about this backend is that a new
 * environment shares the data with every existing one, and a console that hid
 * that behind a tooltip would be hiding the single fact an operator most needs
 * before pressing a button that creates a second API over production tables.
 */

export function EnvironmentCard({
  stage,
  environment,
  state,
  onDeploy,
  deployable,
  busy,
}: {
  stage: string;
  environment: EnvironmentView | null;
  state: ConsoleState | null;
  onDeploy: () => void;
  deployable: boolean;
  busy: boolean;
}) {
  const healthy = environment?.stacks.filter((stack) => stack.healthy).length ?? 0;
  // The same verdict the environment's row carries in the list: one function, so
  // a row that says "deployed" cannot sit above a card that says otherwise.
  const status = backendState(environment, state?.identity?.account ?? null);
  // Before the first read, `environment` is null for *every* stage — so nothing
  // here may treat that as "there is no config file". The two are the same shape
  // and opposite meanings, and the wrong one is the alarming one.
  const reading = state === null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="truncate font-mono text-2xl font-semibold tracking-tight">{stage}</h2>
            {reading ? null : (
              <Chip tone={status.tone}>
                <Dot tone={status.tone} />
                {status.label}
              </Chip>
            )}
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {reading
              ? "Reading the stacks…"
              : environment
                ? `account ${environment.account} · ${environment.region} · ${
                    environment.ownsEverything
                      ? "its own tables, media and pool"
                      : `${environment.tables} imported tables`
                  }`
                : "no config file yet — the plan writes one"}
          </p>
        </div>

        <Button
          variant="primary"
          onClick={onDeploy}
          disabled={!deployable}
          busy={busy}
          icon={<RocketIcon className="size-4" />}
        >
          Deploy {stage}
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stackTiles(environment, reading).map((tile) => (
          <StackTile key={tile.name} tile={tile} />
        ))}
      </div>

      {environment?.apiUrl ? (
        <div className="text-muted-foreground mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/40 pt-4 font-mono text-xs">
          <span className="text-foreground/70">API</span>
          <span className="truncate" title={environment.apiUrl}>
            {apiHost(environment.apiUrl)}
          </span>
          {environment.cognitoDomain ? (
            <>
              <span className="text-border">·</span>
              <span className="truncate" title={environment.cognitoDomain}>
                {environment.cognitoDomain}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2.5 border-t border-border/40 pt-4">
        {reading ? null : environment?.ownsEverything ? (
          <p className="text-muted-foreground flex gap-2.5 text-xs leading-relaxed">
            <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              This environment <span className="text-foreground/80">creates everything</span>: its
              own tables, its own videos bucket and CloudFront distribution, its own Cognito user
              pool — all named <span className="font-mono">play-{stage}-*</span>, all empty, and all
              retained if the stack is deleted. Nothing is shared with another environment, so a
              deploy here cannot change what{" "}
              <span className="font-mono">dev</span> reads.
            </span>
          </p>
        ) : environment ? (
          <>
            <p className="text-muted-foreground flex gap-2.5 text-xs leading-relaxed">
              <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                The tables, the videos bucket, the CloudFront distribution and the Cognito user pool
                are <span className="text-foreground/80">imported</span> — CloudFormation will not
                change or delete one. A deploy here creates the{" "}
                <span className="text-foreground/80">
                  {healthy === 0 ? "four" : "environment's own"}
                </span>{" "}
                API, media roles and sign-up trigger, and it{" "}
                <span className="text-foreground/80">points at the same data</span> as every other
                stage that imports.
              </span>
            </p>

            {/* The two things that are genuinely shared-and-singleton. Both are
                stated here rather than left to the checklist, because both are
                consequences of pressing the button — not details of how it is
                pressed. They are also the reason a new environment should
                create its own: neither applies when it does. */}
            <p className="text-muted-foreground flex gap-2.5 text-xs leading-relaxed">
              <span
                className="mt-0.5 size-3.5 shrink-0 text-center font-mono leading-none"
                aria-hidden
              >
                ·
              </span>
              <span>
                Two of those can only have{" "}
                <span className="text-foreground/80">one owner at a time</span>: the bucket notifies
                one function for <span className="font-mono">uploads/</span>, and the pool's pre
                sign-up trigger calls one function. Deploying a stage{" "}
                <span className="text-foreground/80">takes video processing</span> from whichever
                stage had it, and <span className="text-foreground/80">leaves the trigger alone</span>{" "}
                — the checklist reports the second and names what the first costs.
              </span>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground flex gap-2.5 text-xs leading-relaxed">
            <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              There is no config file for{" "}
              <span className="font-mono">{stage}</span> yet. The plan writes one on the way through
              — a <span className="text-foreground/80">new environment</span>, creating its own
              tables, media and user pool rather than importing another stage's.
            </span>
          </p>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * The four stacks
 * ------------------------------------------------------------------ */

interface Tile {
  name: string;
  word: string;
  status: string;
  tone: Tone;
  exists: boolean;
}

function stackTiles(environment: EnvironmentView | null, reading: boolean): Tile[] {
  const words = ["Data", "Media", "Auth", "Api"];
  return words.map((word) => {
    const found: StackSummary | undefined = environment?.stacks.find(
      (stack) => stackWord(stack.name) === word,
    );
    if (reading || !found || found.status === "NOT_DEPLOYED") {
      return {
        name: `Play${word}Stack`,
        word,
        status: reading ? "reading…" : "not deployed",
        tone: "muted",
        exists: false,
      };
    }
    return {
      name: found.name,
      word,
      status: found.healthy ? "complete" : found.status.toLowerCase().replace(/_/g, " "),
      tone: found.healthy ? "ok" : found.status.includes("IN_PROGRESS") ? "run" : "bad",
      exists: true,
    };
  });
}

function StackTile({ tile }: { tile: Tile }) {
  return (
    <div
      title={tile.name}
      className={cn(
        "border-border/60 bg-background/40 flex flex-col gap-1.5 rounded-2xl border px-3 py-3",
        !tile.exists && "border-dashed",
      )}
    >
      <div className="flex items-center gap-2">
        <Dot tone={tile.tone} pulse={tile.tone === "run"} />
        <span className="text-sm font-medium">{stackInitials(tile.word)}</span>
      </div>
      <span className="text-muted-foreground truncate text-xs">{tile.status}</span>
    </div>
  );
}
