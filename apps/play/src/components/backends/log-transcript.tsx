"use client";

import { useMemo, useState } from "react";
import { ArrowUpDownIcon, ChevronRightIcon, TerminalIcon } from "lucide-react";

import { Chip, type Tone } from "@/components/ui/chip";
import { clockTime } from "@/lib/format";
import { parseLogLine, type ParsedLogLine } from "@/lib/logs";
import type { LogEventView } from "@/lib/types";
import { cn } from "@/lib/cn";

/**
 * The logs, as a table of collapsed lines.
 *
 * ## Why rows are closed
 *
 * A CloudWatch pane is a column of monospace in which every line is the same
 * height, the same colour and the same weight, and the two lines that matter —
 * the error, and the report saying the function is one payload away from running
 * out of memory — are indistinguishable from the 190 around them until you read
 * every one. So a line is a **single truncated row that opens**, the newest
 * first: what you scan is a page of first lines, and what you read is the one you
 * opened.
 *
 * ## Colour is the answer, not decoration
 *
 * The type of a line is carried by its colour, and each one means what it means
 * everywhere else in this console: an exception is `destructive`, a handler's
 * own `ERROR` level is `destructive` even though the runtime framed it as an
 * ordinary line, and everything that is merely a fact — a report, a start, an
 * end — is grey. A colour here has to mean something, and green on every
 * invocation a function ever served means nothing at all.
 *
 * ## Two columns, and a sort
 *
 * `Timestamp` and `Message`, with the timestamp as the sort control — descending
 * by default, because the line somebody is looking for is nearly always the one
 * that just happened. Opening a row reveals what the closed one had to cut: the
 * whole sentence, the object pretty-printed, the exception's stack, or a report's
 * numbers as pairs.
 */
export function LogTranscript({
  events,
  note,
}: {
  events: LogEventView[];
  /** Why the pane is empty, when it is — from the route's own answer. */
  note: string | null;
}) {
  /** Newest first: see the module comment. */
  const [descending, setDescending] = useState(true);

  const lines = useMemo(() => {
    // Parsed once, here, and keyed by the position the server sent — a key of the
    // order on screen would remount every row when the sort flips, and an opened
    // row would close itself for being reordered.
    const parsed = events.map((event, index) => ({
      key: index,
      event,
      line: parseLogLine(event.message),
    }));
    return descending ? parsed.reverse() : parsed;
  }, [events, descending]);

  if (events.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 py-2 text-xs">
        <TerminalIcon className="size-3.5" />
        {note ?? "Nothing to show."}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="text-muted-foreground border-border/40 flex items-center gap-3 border-b pb-1.5 text-xs">
        <span className="size-3.5 shrink-0" aria-hidden />
        <button
          type="button"
          onClick={() => setDescending((current) => !current)}
          title={descending ? "Newest first" : "Oldest first"}
          className="hover:text-foreground flex w-20 shrink-0 items-center gap-1 text-left transition-colors"
        >
          Timestamp
          <ArrowUpDownIcon className="size-3 opacity-60" />
        </button>
        <span className="min-w-0 flex-1">Message</span>
      </div>

      {lines.map(({ key, event, line }) => (
        <Line key={key} event={event} line={line} />
      ))}
    </div>
  );
}

function Line({ event, line }: { event: LogEventView; line: ParsedLogLine }) {
  const tone = toneOf(line);

  return (
    <details className="group border-border/25 open:bg-muted/20 border-b last:border-b-0">
      <summary className="hover:bg-muted/40 flex cursor-pointer items-baseline gap-2 py-1.5">
        <ChevronRightIcon className="text-muted-foreground/60 mt-0.5 w-4 shrink-0 transition-transform group-open:rotate-90" />

        <span className="text-muted-foreground/60 w-20 shrink-0 text-xs tabular-nums">
          {clockTime(event.at)}
        </span>

        {/* Wide enough for the longest tag, so the message starts at the same
            column on every row — a table rather than a ragged edge. */}
        <span className="w-18 shrink-0">
          <Tag line={line} />
        </span>

        {/* The whole line, on one row, cut to the width it has. */}
        <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", INK[tone])}>
          {preview(line) || <span className="text-muted-foreground/50">—</span>}
        </span>

        {/* The request it belongs to, short: the way one invocation is followed
            through a busy function without reading every id in full. */}
        {line.requestId ? (
          <span
            title={line.requestId}
            className="text-muted-foreground/50 shrink-0 font-mono text-xs"
          >
            {line.requestId.slice(0, 8)}
          </span>
        ) : null}
      </summary>

      {/* Indented under the chevron rather than under the message column: what
          opens here is an object and a stack, and both want the width. */}
      <div className="flex flex-col gap-2 pb-3 pl-6">
        {/* A report's numbers as pairs, which is what the closed row had to
            flatten into one sentence. */}
        {line.fields.length ? (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {line.fields.map((field) => (
              <span key={field.label} className="inline-flex items-baseline gap-1.5 text-xs">
                <span className="text-muted-foreground/70">{field.label}</span>
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    field.tone === "warn" && "text-warn font-medium",
                  )}
                  title={field.tone === "warn" ? "Close to the memory limit" : undefined}
                >
                  {field.value}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {line.text ? (
          <p
            className={cn(
              "font-mono text-xs break-all whitespace-pre-wrap",
              line.kind === "error" && "text-destructive",
            )}
          >
            {line.text}
          </p>
        ) : null}

        {line.data ? (
          <pre className="text-muted-foreground max-h-96 overflow-auto font-mono text-xs leading-relaxed">
            {JSON.stringify(line.data, null, 2)}
          </pre>
        ) : line.json ? (
          <pre className="text-muted-foreground font-mono text-xs break-all whitespace-pre-wrap">
            {line.json}
          </pre>
        ) : null}

        {line.stack ? (
          <pre className="text-muted-foreground max-h-60 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {line.stack}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

/** One column of the closed row: the line's sentence, or a report's numbers. */
function preview(line: ParsedLogLine): string {
  if (line.kind === "report") {
    return line.fields.map((field) => `${field.label}: ${field.value}`).join("   ");
  }

  const parts = [line.text, line.json].filter((part): part is string => Boolean(part));
  return parts.join("  ");
}

/**
 * What kind of line this is.
 *
 * The handler's own level beats the runtime's framing: a JSON line that says
 * `level: "error"` is an error even though nothing marked it as one, and it is
 * the line somebody is scrolling for.
 */
function toneOf(line: ParsedLogLine): Tone {
  if (line.kind === "error") return "bad";

  const level = line.level?.toUpperCase() ?? "";
  if (level === "ERROR" || level === "FATAL") return "bad";
  if (level === "WARN" || level === "WARNING") return "warn";

  switch (line.kind) {
    case "start":
    case "end":
      // Bookends: a fact rather than a verdict, and 190 of them is the noise the
      // one interesting line has to stand out from.
      return "muted";
    case "report":
      // Grey, not green: a report is a completed request with its numbers, not
      // a thing that went well — every invocation writes one, success or
      // failure, so colouring them green makes a page of them look like a page
      // of good news. What is worth a colour inside a report is the one number
      // that is close to a limit, and that keeps its own tone.
      return "muted";
    default:
      return "accent";
  }
}

/**
 * The ink a line's text is drawn in.
 *
 * Written out rather than interpolated, because Tailwind reads the source for
 * class names: `text-${tone}` would be a transcript of unstyled text.
 */
const INK: Record<Tone, string> = {
  muted: "text-muted-foreground/70",
  ok: "text-ok",
  run: "text-run",
  warn: "text-warn",
  bad: "text-destructive",
  accent: "text-foreground/90",
};

function Tag({ line }: { line: ParsedLogLine }) {
  const { label, tone } = tagFor(line);
  if (!label) return null;

  return (
    <Chip tone={tone} className="px-1.5 py-0 text-xs">
      {label}
    </Chip>
  );
}

function tagFor(line: ParsedLogLine): { label: string; tone: Tone } {
  if (line.kind === "error") return { label: "ERROR", tone: "bad" };

  const level = line.level?.toUpperCase() ?? "";
  if (level === "ERROR" || level === "FATAL") return { label: level, tone: "bad" };
  if (level === "WARN" || level === "WARNING") return { label: "WARN", tone: "warn" };

  switch (line.kind) {
    case "start":
      return { label: line.text === "Init" ? "INIT" : "START", tone: "muted" };
    case "end":
      return { label: "END", tone: "muted" };
    case "report":
      return { label: "REPORT", tone: "muted" };
    case "json":
      return { label: level || "LOG", tone: level === "INFO" ? "muted" : "accent" };
    default:
      return { label: level, tone: "accent" };
  }
}
