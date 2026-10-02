"use client";

import { TerminalIcon } from "lucide-react";

import { Chip, type Tone } from "@/components/ui/chip";
import { parseLogLine, type ParsedLogLine } from "@/lib/logs";
import { clockTime } from "@/lib/format";
import type { LogEventView } from "@/lib/types";

/**
 * The logs, one parsed line at a time.
 *
 * A CloudWatch pane is a column of monospace in which every line looks like
 * every other line, and the two that matter — the error and the report saying
 * the function is one payload away from running out of memory — are the same
 * weight and colour as the 190 `INFO` lines around them. So each line is taken
 * apart (`lib/logs`) and drawn as what it is:
 *
 * | Line | Drawn as |
 * | --- | --- |
 * | `START` / `END` | a muted tag and the version — a request's bookends |
 * | `REPORT` | its numbers, as label/value pairs, with the memory highlighted when it is close to the limit |
 * | `ERROR Invoke Error {…}` | the message in the destructive tone, with the type and the stack beneath it |
 * | the handler's JSON | the `msg` as the line, and the object beside it as `{ key: value }` |
 * | anything else | the text |
 *
 * The **request id** is drawn once per line as a short chip rather than left
 * inside the text: it is the only way to follow one invocation through a busy
 * function, and shortening it is what makes it fit beside every line.
 *
 * The column of times comes from the CloudWatch event rather than from the line,
 * because Lambda's own framing prefix carries the same instant and drawing both
 * would say it twice on every row.
 */
export function LogTranscript({
  events,
  note,
}: {
  events: LogEventView[];
  /** Why the pane is empty, when it is — from the route's own answer. */
  note: string | null;
}) {
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
      {events.map((event, index) => (
        <Line key={`${event.at}-${index}`} event={event} />
      ))}
    </div>
  );
}

function Line({ event }: { event: LogEventView }) {
  const line = parseLogLine(event.message);

  return (
    <div className="border-border/25 flex gap-3 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground/60 w-16 shrink-0 pt-0.5 text-xs tabular-nums">
        {clockTime(event.at)}
      </span>

      <span className="w-14 shrink-0 pt-0.5">
        <Tag line={line} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {line.requestId ? (
            <span
              title={line.requestId}
              className="text-muted-foreground/60 shrink-0 font-mono text-xs"
            >
              {line.requestId.slice(0, 8)}
            </span>
          ) : null}

          {line.text ? (
            <span
              title={event.message}
              className={
                line.kind === "error"
                  ? "text-destructive font-mono text-xs break-all whitespace-pre-wrap"
                  : "font-mono text-xs break-all whitespace-pre-wrap"
              }
            >
              {line.text}
            </span>
          ) : null}

          {line.json ? (
            <span
              className="text-muted-foreground font-mono text-xs break-all"
              title={line.json}
            >
              {line.json}
            </span>
          ) : null}
        </div>

        {line.fields.length ? (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
            {line.fields.map((field) => (
              <span key={field.label} className="inline-flex items-baseline gap-1.5 text-xs">
                <span className="text-muted-foreground/70">{field.label}</span>
                <span
                  className={
                    field.tone === "warn"
                      ? "text-warn font-mono font-medium tabular-nums"
                      : "font-mono tabular-nums"
                  }
                  title={field.tone === "warn" ? "Close to the memory limit" : undefined}
                >
                  {field.value}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {line.stack ? (
          <pre className="text-muted-foreground mt-1 max-h-40 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {line.stack}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What kind of line this is, in one word.
 *
 * The handler's own level wins over nothing: a JSON line that says `level:
 * "error"` is an error line even though the runtime did not frame it as one, and
 * that is the line somebody is scrolling for. `INIT_START` and a report are
 * facts rather than verdicts, so they stay muted.
 */
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
      // A bare line with no framing and no level is a runtime message — a
      // timeout, a platform event — and it is a fact rather than a level.
      return { label: level, tone: "accent" };
  }
}
