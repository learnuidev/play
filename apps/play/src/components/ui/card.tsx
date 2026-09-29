import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A frame, not a box.
 *
 * The repository's vocabulary: panels are large radii with hairline edges on a
 * tinted canvas, so a card reads as a frame around a piece of the page rather
 * than as a container drawn around every concern. `flush` drops the padding for
 * the one card that holds a full-bleed transcript.
 */
export function Card({
  children,
  className,
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section
      className={cn(
        "border-border/60 bg-card/70 rounded-3xl border backdrop-blur-sm",
        !flush && "p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A sentence in the heading's voice, and an optional line of explanation. */
export function CardHeading({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="text-muted-foreground mt-1 text-sm">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}
