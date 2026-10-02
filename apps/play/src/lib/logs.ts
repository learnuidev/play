/**
 * A Lambda log line, taken apart.
 *
 * CloudWatch hands back what the runtime wrote, and a runtime writes four
 * different things in four different shapes: its own `START`/`END`/`REPORT`
 * framing, the `ERROR Invoke Error {…}` block when a handler threw, and whatever
 * the handler itself printed — which in this product is almost always
 * `console.log(JSON.stringify({ level, msg, data }))`.
 *
 * Printed raw, all of it is one monospace wall in which the interesting line is
 * the one you cannot see. Taken apart, each line becomes what it is: a request
 * starting, a handler's sentence with its object beside it, a report whose
 * numbers are the answer to "why is this slow", or an exception with its type,
 * its message and its stack in three different weights.
 *
 * Pure functions over a string, in `lib/` because the console draws log lines in
 * more than one place and a second parser would be a second answer to "what does
 * this line say".
 */

export type LogLineKind = "start" | "end" | "report" | "error" | "json" | "text";

/** One `label: value` pair — a REPORT's numbers, or an exception's parts. */
export interface LogField {
  label: string;
  value: string;
  /** Set when a number is worth looking at: memory near the limit. */
  tone?: "warn";
}

export interface ParsedLogLine {
  kind: LogLineKind;
  /** `INFO`, `ERROR`, … — from Lambda's framing or the handler's own JSON. */
  level: string | null;
  /** The request this line belongs to, short and shared by START/END/REPORT. */
  requestId: string | null;
  /** The line's sentence: a handler's message, an exception's, or nothing. */
  text: string;
  /** The numbers or parts, when the line has any. */
  fields: LogField[];
  /** The line's object, compact — the handler's payload, drawn beside the text. */
  json: string | null;
  /** An exception's stack, if it brought one. */
  stack: string | null;
}

/**
 * What the Lambda runtime puts in front of a line a handler printed.
 *
 * `2026-09-01T13:49:31.406Z\t<requestId>\tINFO\t<message>` — the *unfiltered*
 * format, which is what CloudWatch stores. It is stripped rather than drawn: the
 * timestamp is already the event's own, and both halves are shown as their own
 * columns, so keeping them in the text would print everything twice.
 */
const FRAMING = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\t([0-9a-fA-F-]{8,})\t([A-Z]+)\t([\s\S]*)$/;

const START = /^START RequestId: (\S+) Version: (\S+)$/;
const END = /^END RequestId: (\S+)$/;
const REPORT = /^REPORT RequestId: (\S+)\t([\s\S]*)$/;
/** An uncaught handler error, with the runtime's JSON appended after a tab. */
const INVOKE_ERROR = /^ERROR Invoke Error\s*\t([\s\S]*)$/;
const INIT_START = /^INIT_START Runtime Version: ([^\s]+) Runtime Version ARN: (\S+)$/;

/** How much of a long JSON line is drawn before it is clipped and said so. */
const MAX_JSON_CHARS = 1000;

export function parseLogLine(message: string): ParsedLogLine {
  const empty: ParsedLogLine = {
    kind: "text",
    level: null,
    requestId: null,
    text: "",
    fields: [],
    json: null,
    stack: null,
  };

  const framed = FRAMING.exec(message);
  const body = framed ? framed[4] : message;
  const framing = {
    requestId: framed ? framed[2] : null,
    level: framed ? framed[3] : null,
  };

  const start = START.exec(body);
  if (start) {
    return { ...empty, ...framing, kind: "start", requestId: start[1], text: start[2] };
  }

  const end = END.exec(body);
  if (end) {
    return { ...empty, ...framing, kind: "end", requestId: end[1] };
  }

  const init = INIT_START.exec(body);
  if (init) {
    return {
      ...empty,
      kind: "start",
      text: "Init",
      fields: [
        { label: "Runtime", value: init[1] },
        { label: "ARN", value: init[2] },
      ],
    };
  }

  const report = REPORT.exec(body);
  if (report) {
    return {
      ...empty,
      kind: "report",
      requestId: report[1],
      fields: reportFields(report[2]),
    };
  }

  const invoke = INVOKE_ERROR.exec(body);
  if (invoke) {
    return { ...empty, ...framing, kind: "error", ...errorParts(invoke[1]) };
  }

  // A line the handler printed. Almost always JSON here, and when it is, the
  // sentence comes out of it: `{ level, msg, data }` is this product's own
  // shape, and "user created" is the line a person is scanning for.
  const object = tryJson(body);
  if (object !== null && typeof object === "object" && !Array.isArray(object)) {
    const record = object as Record<string, unknown>;
    const level = typeof record.level === "string" ? record.level : framing.level;
    const message = stringOf(record.msg) ?? stringOf(record.message);
    const rest = { ...record };
    delete rest.level;
    if (message !== null) {
      delete rest.msg;
      delete rest.message;
    }

    return {
      kind: "json",
      level,
      requestId: framing.requestId,
      text: message ?? "",
      fields: [],
      json: Object.keys(rest).length ? clip(compact(rest)) : null,
      stack: null,
    };
  }

  // Not JSON, but a level the runtime framed: `INFO something happened`.
  return { ...empty, ...framing, text: body };
}

/**
 * A REPORT's numbers.
 *
 * Tab-separated `Label: value` pairs, in the runtime's own order. The one worth
 * a second look is the memory: a function at 87 MB of 128 MB is a function that
 * will start failing at the next slightly larger payload, and that is a fact a
 * number in a line of numbers does not say.
 */
function reportFields(rest: string): LogField[] {
  const fields = rest
    .split("\t")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(": ");
      if (at < 0) return { label: part, value: "" };
      return { label: part.slice(0, at), value: part.slice(at + 2) };
    });

  const used = megabytes(fields.find((field) => field.label === "Max Memory Used")?.value);
  const limit = megabytes(fields.find((field) => field.label === "Memory Size")?.value);

  return fields.map((field) =>
    field.label === "Max Memory Used" && used !== null && limit !== null && used / limit >= 0.8
      ? { ...field, tone: "warn" as const }
      : field,
  );
}

/** An exception, in its three parts. */
function errorParts(raw: string): Pick<ParsedLogLine, "text" | "stack" | "fields" | "level"> {
  const parsed = tryJson(raw.trim());
  if (parsed === null || typeof parsed !== "object") {
    return { text: raw.trim(), stack: null, fields: [], level: "ERROR" };
  }

  const error = parsed as Record<string, unknown>;
  const type = stringOf(error.errorType);
  const message = stringOf(error.errorMessage) ?? stringOf(error.message);
  const stack = Array.isArray(error.stack)
    ? error.stack.map(String).join("\n")
    : stringOf(error.stack);

  return {
    text: message ?? raw.trim(),
    level: "ERROR",
    stack: stack ? clip(stack, 4000) : null,
    fields: type ? [{ label: "Type", value: type }] : [],
  };
}

/**
 * A value as JavaScript would print it: `{ name: "Claire", age: 4 }`.
 *
 * Not `JSON.stringify`, because a log line is read left to right and a wall of
 * quoted keys is harder to scan than the object shape it is describing. This is
 * a *rendering*, so it is allowed to be the prettier of the two — the raw line
 * is still in CloudWatch for anybody who needs it byte-for-byte.
 */
function compact(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => compact(item, depth)).join(", ")}]`;
  if (typeof value === "object") {
    // Nested objects are still shown whole; only the depth is capped, so that a
    // circular-looking payload cannot produce an endless line.
    if (depth >= 3) return "{ … }";
    return `{ ${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${compact(item, depth + 1)}`)
      .join(", ")} }`;
  }
  return JSON.stringify(value) ?? String(value);
}

function tryJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `87 MB` → `87`. Null for anything that is not a size in megabytes. */
function megabytes(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([\d.]+)\s*MB$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

function clip(text: string, limit = MAX_JSON_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… (${text.length} characters)`;
}
