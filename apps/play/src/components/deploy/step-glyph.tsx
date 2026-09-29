import {
  CheckIcon,
  MinusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";
import type { StepStatus } from "@/lib/types";

/**
 * The check mark, in its six states.
 *
 * The state is the icon and the colour, never the colour alone: a filled circle
 * with a tick, a hairline circle with a tick, an amber warning, a rose cross and
 * a muted dash are five different shapes before they are four different colours,
 * which is what makes the column readable at a glance and still readable to
 * somebody who cannot separate the greens from the ambers.
 */
export function StepGlyph({ status, className }: { status: StepStatus; className?: string }) {
  const shell = cn(
    "relative flex size-6 shrink-0 items-center justify-center rounded-full",
    className,
  );

  switch (status) {
    case "passed":
      return (
        <span className={cn(shell, "bg-ok text-ok-foreground")}>
          <CheckIcon className="size-3.5" strokeWidth={3} />
        </span>
      );

    case "skipped":
      return (
        <span className={cn(shell, "border-ok/50 text-ok border")}>
          <CheckIcon className="size-3.5" strokeWidth={3} />
        </span>
      );

    case "running":
      return (
        <span className={cn(shell, "border-run/30 border")}>
          <span className="cp-sweep border-run border-t-transparent absolute inset-0 rounded-full border-2" />
          <span className="bg-run size-1.5 rounded-full" />
        </span>
      );

    case "failed":
      return (
        <span className={cn(shell, "bg-destructive text-destructive-foreground")}>
          <XIcon className="size-3.5" strokeWidth={3} />
        </span>
      );

    case "warned":
      return (
        <span className={cn(shell, "bg-warn text-warn-foreground")}>
          <TriangleAlertIcon className="size-3.5" strokeWidth={2.5} />
        </span>
      );

    case "halted":
      return (
        <span className={cn(shell, "border-border text-muted-foreground border")}>
          <MinusIcon className="size-3" strokeWidth={3} />
        </span>
      );

    default:
      return <span className={cn(shell, "border-border/70 border border-dashed")} />;
  }
}

/** The word for a state, so a row says what its glyph shows. */
export function stepStatusLabel(status: StepStatus, satisfiedLabel: string): string {
  switch (status) {
    case "passed":
      return "Done";
    case "skipped":
      return satisfiedLabel;
    case "running":
      return "Working";
    case "failed":
      return "Failed";
    case "warned":
      return "Optional, skipped";
    case "halted":
      return "Not reached";
    default:
      return "Next";
  }
}

export function stepTone(status: StepStatus) {
  switch (status) {
    case "passed":
      return "ok" as const;
    case "skipped":
      return "ok" as const;
    case "running":
      return "run" as const;
    case "failed":
      return "bad" as const;
    case "warned":
      return "warn" as const;
    default:
      return "muted" as const;
  }
}
