import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A pill.
 *
 * Tones carry meaning and nothing else: `ok` is a thing that is done and
 * correct, `run` is a thing happening now, `warn` is an optional step that did
 * not work, `bad` is a stopped run, `muted` is a fact with no verdict in it. A
 * chip never uses a colour to mean "special".
 */

export type Tone = "muted" | "ok" | "run" | "warn" | "bad" | "accent";

const TONES: Record<Tone, string> = {
  muted: "border-border/70 bg-muted/50 text-muted-foreground",
  ok: "border-ok/30 bg-ok/12 text-ok",
  run: "border-run/30 bg-run/12 text-run",
  warn: "border-warn/35 bg-warn/12 text-warn",
  bad: "border-destructive/35 bg-destructive/12 text-destructive",
  accent: "border-foreground/15 bg-foreground/8 text-foreground",
};

export function Chip({
  tone = "muted",
  children,
  className,
  title,
  monospace = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
  monospace?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        monospace && "font-mono tabular-nums",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small filled dot, for a chip or a list row that needs a status at a glance. */
export function Dot({
  tone = "muted",
  pulse = false,
  className,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  const FILL: Record<Tone, string> = {
    muted: "bg-muted-foreground/50",
    ok: "bg-ok",
    run: "bg-run",
    warn: "bg-warn",
    bad: "bg-destructive",
    accent: "bg-foreground",
  };
  return (
    <span className={cn("relative inline-flex size-1.5 shrink-0", className)}>
      {pulse ? (
        <span className={cn("absolute inset-0 animate-ping rounded-full", FILL[tone])} />
      ) : null}
      <span className={cn("relative inline-flex size-1.5 rounded-full", FILL[tone])} />
    </span>
  );
}
