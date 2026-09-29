"use client";

import { CheckIcon, ChevronDownIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { clockTime } from "@/lib/format";
import type { LogLine } from "@/lib/types";

/**
 * The transcript.
 *
 * A console, not a textarea: monospace, tabular timestamps, one column, and the
 * stream's own distinction between what the tool said and what it complained
 * about. Three details are what make it usable rather than decorative:
 *
 * - **It follows the bottom while you are at the bottom.** Scrolling up to read
 *   something stops the follow — nothing is more irritating than a pane that
 *   yanks itself back — and a button puts you at the end again.
 * - **Lines the tools themselves mark** — `✅`, `✨`, `❌`, `⏳` and a leading
 *   `$` — are coloured, because those are the lines anybody is scanning for and
 *   they are already marked in the source.
 * - **Copy takes the whole step.** A transcript you cannot get out of the
 *   browser is a transcript you retype into a bug report.
 */

const MARKERS: Array<[RegExp, string]> = [
  [/^\s*(?:✅|✨|✔)/, "text-ok"],
  [/^\s*(?:❌|✖|🛑)/, "text-destructive"],
  [/^\s*(?:⏳|ℹ|📦|🗑)/, "text-run"],
  [/^\s*\$\s/, "text-foreground/90"],
];

function lineClass(line: LogLine): string {
  if (line.stream === "err") return "text-destructive";
  if (line.stream === "note") return "text-muted-foreground";
  for (const [pattern, className] of MARKERS) {
    if (pattern.test(line.text)) return className;
  }
  return "text-foreground/70";
}

export function Transcript({
  lines,
  title,
  hint,
  droppedLines,
  className,
  compact = false,
}: {
  lines: LogLine[];
  title: string;
  hint?: string;
  droppedLines?: number;
  className?: string;
  /** Shorter, for a transcript inside a card rather than a section of its own. */
  compact?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [copied, setCopied] = useState(false);

  // `pinned` is measured rather than assumed: a reader who scrolled up to read a
  // failure must not be pulled back to the end by the next line.
  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    setPinned(distance < 24);
  };

  useEffect(() => {
    if (!pinned) return;
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [lines, pinned]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.map((line) => line.text).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the pane is still selectable.
    }
  };

  const jump = () => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    setPinned(true);
  };

  return (
    <div className={cn("border-border/60 bg-card/70 overflow-hidden rounded-3xl border", className)}>
      <div className="border-border/40 flex h-11 items-center gap-3 border-b px-4">
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium">{title}</span>
          {hint ? (
            <span className="text-muted-foreground truncate text-xs">{hint}</span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {droppedLines && droppedLines > 0 ? (
            <span className="text-muted-foreground hidden font-mono text-xs sm:inline">
              {droppedLines} earlier {droppedLines === 1 ? "line" : "lines"} dropped
            </span>
          ) : null}
          <IconButton onClick={copy} title="Copy this step's output" aria-label="Copy output">
            {copied ? <CheckIcon className="text-ok size-3.5" /> : <CopyIcon className="size-3.5" />}
          </IconButton>
        </div>
      </div>

      <div className="relative">
        <div
          ref={scroller}
          onScroll={onScroll}
          className={cn(
            "cp-transcript overflow-y-auto px-4 py-3 text-xs leading-relaxed",
            compact ? "h-48 sm:h-56" : "h-72 sm:h-96",
          )}
        >
          {lines.length === 0 ? (
            <p className="text-muted-foreground">Nothing has been printed for this step yet.</p>
          ) : (
            lines.map((line) => (
              <div key={line.seq} className="flex gap-3">
                <span className="text-muted-foreground/50 w-16 shrink-0 select-none tabular-nums">
                  {clockTime(line.at)}
                </span>
                <span className={cn("min-w-0 flex-1 break-words whitespace-pre-wrap", lineClass(line))}>
                  {line.text || "\u00a0"}
                </span>
              </div>
            ))
          )}
        </div>

        {!pinned ? (
          <button
            type="button"
            onClick={jump}
            className="border-border/60 bg-card/95 text-foreground absolute right-4 bottom-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-sm"
          >
            <ChevronDownIcon className="size-3.5" />
            Jump to latest
          </button>
        ) : null}
      </div>
    </div>
  );
}
