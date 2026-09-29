"use client";

import { useEffect, useState } from "react";

import { Chip } from "@/components/ui/chip";
import { StepGlyph, stepStatusLabel, stepTone } from "@/components/deploy/step-glyph";
import { cn } from "@/lib/cn";
import { duration } from "@/lib/format";
import type { StepView } from "@/lib/types";

/**
 * The checklist.
 *
 * A step is a row you can open, and the open one is the one whose transcript is
 * below. That pairing is the whole interface: thirteen rows say *what* the plan
 * will do and how far it has got, and the pane underneath says *what it is
 * saying right now* about the one you are looking at.
 *
 * The connector between the rows is drawn rather than implied. A checklist that
 * is a list of thirteen identical rows reads as thirteen options; one with a line
 * running down it reads as an order, which is what it is.
 */

/**
 * How long a step has taken.
 *
 * It ticks itself while it is still going, rather than reading the clock in the
 * row's render: the row is inside a list beside a transcript of several hundred
 * lines, and re-rendering both every second to move one number is a page that
 * stutters while it is the most interesting thing on screen.
 */
function Elapsed({
  startedAt,
  finishedAt,
}: {
  startedAt: number | null;
  finishedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt || finishedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, finishedAt]);

  if (!startedAt) return <span className="hidden w-14 sm:inline" aria-hidden />;

  return (
    <span className="text-muted-foreground/70 hidden w-14 text-right font-mono text-xs tabular-nums sm:inline">
      {duration((finishedAt ?? now) - startedAt)}
    </span>
  );
}

export function StepList({
  steps,
  selected,
  onSelect,
  disabled = false,
}: {
  steps: StepView[];
  selected: string | null;
  onSelect: (stepId: string) => void;
  disabled?: boolean;
}) {
  return (
    <ol className="relative -mx-1">
      {steps.map((step, index) => (
        <li key={step.id} className="relative">
          {index < steps.length - 1 ? (
            <span
              aria-hidden
              className="bg-border/60 absolute top-10 bottom-0 left-3.5 w-px"
            />
          ) : null}

          <button
            type="button"
            onClick={() => onSelect(step.id)}
            aria-current={selected === step.id ? "step" : undefined}
            disabled={disabled}
            className={cn(
              "relative flex w-full items-start gap-3 overflow-hidden rounded-2xl px-1 py-2.5 text-left transition-colors",
              selected === step.id ? "bg-accent/70" : "hover:bg-accent/40",
              disabled && "cursor-default",
            )}
          >
            {/* The step being worked on breathes rather than spins: a sheen
                across the row leaves every glyph at full contrast, which is
                what a row somebody is reading has to do. */}
            {step.status === "running" ? (
              <span aria-hidden className="cp-sheen pointer-events-none absolute inset-0 opacity-60" />
            ) : null}

            <StepGlyph status={step.status} className="mt-0.5" />

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "truncate text-sm font-medium",
                    step.status === "pending" && "text-muted-foreground",
                  )}
                >
                  {step.title}
                </span>
                {step.optional ? (
                  <Chip tone="muted" className="shrink-0">
                    optional
                  </Chip>
                ) : null}
              </span>
              {step.note ? (
                <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                  {step.note}
                </span>
              ) : null}
            </span>

            <span className="flex shrink-0 items-center gap-2 pt-0.5">
              <Chip tone={stepTone(step.status)}>{stepStatusLabel(step.status, step.satisfiedLabel)}</Chip>
              <Elapsed startedAt={step.startedAt} finishedAt={step.finishedAt} />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
