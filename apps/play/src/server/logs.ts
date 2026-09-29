import type { BackendFunctionView, BackendLogs, LogEventView } from "@/lib/types";
import { awsJson } from "./aws";

/**
 * The backend's logs, read out of CloudWatch.
 *
 * Every Lambda here logs to `/aws/lambda/play-<stage>-<key>` — the name is
 * derived rather than discovered, because `api-stack.ts` sets `functionName` and
 * CloudWatch names the group after it.
 *
 * ## Why one function at a time
 *
 * `FilterLogEvents` takes a *single* log group, and a new environment has 158 of
 * them. Fanning out over all of them per request would be 158 API calls to draw
 * a screen, and Logs Insights — which does span groups — needs a query to be
 * started and polled, which is a different shape of interaction than "show me
 * what just happened".
 *
 * So the page asks which function first, defaulting to the ones that are event
 * driven and therefore the ones nobody sees working: `process-video`,
 * `link-federated-user`, and the scheduler. Those fail silently in a way an HTTP
 * handler never does.
 */

/** The functions that never answer a request, and so have nowhere else to say anything. */
export const EVENT_DRIVEN = [
  "process-video",
  "video-processing-complete",
  "subtitle-generation-complete",
  "generate-questions",
  "link-federated-user",
];

interface RawFunction {
  FunctionName: string;
  Runtime?: string;
  LastModified?: string;
}

export async function backendFunctions(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<BackendFunctionView[]> {
  const functions = await awsJson<RawFunction[]>(
    ["lambda", "list-functions", "--max-items", "400", "--query", "Functions"],
    { ...ctx, optional: true },
  ).catch(() => null);

  if (!functions) return [];

  const prefix = `play-${stage}-`;
  return functions
    .filter((fn) => fn.FunctionName.startsWith(prefix))
    .map((fn) => {
      const key = fn.FunctionName.slice(prefix.length);
      return {
        name: fn.FunctionName,
        key,
        logGroup: `/aws/lambda/${fn.FunctionName}`,
        runtime: fn.Runtime ?? null,
        modified: fn.LastModified ?? null,
        /** Worth showing first: a function nothing calls has nothing to show. */
        eventDriven: EVENT_DRIVEN.includes(key),
      };
    })
    .sort((a, b) => {
      if (a.eventDriven !== b.eventDriven) return a.eventDriven ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
}

interface RawEvent {
  timestamp?: number;
  logStreamName?: string;
  message?: string;
}

/**
 * Recent events for one function.
 *
 * `filter-log-events` rather than `tail`: `tail` streams until interrupted, which
 * is a process per open browser tab and does not survive the console restarting.
 * A window is asked for, drawn, and asked for again — the page has a refresh, and
 * a live-ish poll is a decision the person makes rather than one the server makes
 * for them.
 *
 * A log group that does not exist is the normal state of a function nobody has
 * invoked yet, so it is reported as "nothing has run" rather than as an error.
 */
export async function recentLogs(
  stage: string,
  fn: BackendFunctionView,
  options: { minutes?: number; pattern?: string; limit?: number } = {},
  ctx: { profile?: string; region?: string } = {},
): Promise<BackendLogs> {
  const minutes = options.minutes ?? 60;
  const limit = options.limit ?? 200;
  const startTime = Date.now() - minutes * 60_000;

  const argv = [
    "logs",
    "filter-log-events",
    "--log-group-name",
    fn.logGroup,
    "--start-time",
    String(startTime),
    "--limit",
    String(limit),
    "--interleaved",
  ];
  if (options.pattern?.trim()) {
    argv.push("--filter-pattern", options.pattern.trim());
  }

  const body = await awsJson<{ events?: RawEvent[] }>(argv, { ...ctx, optional: true }).catch(
    () => null,
  );

  if (!body) {
    return {
      function: fn.name,
      logGroup: fn.logGroup,
      events: [],
      note: `No log group at ${fn.logGroup} — nothing has invoked this function in this environment.`,
    };
  }

  const events: LogEventView[] = (body.events ?? [])
    .map((event) => ({
      at: event.timestamp ?? 0,
      stream: event.logStreamName ?? "",
      // Lambda's own framing lines arrive as empty strings; they are not noise
      // worth a row.
      message: (event.message ?? "").replace(/\n$/, ""),
    }))
    .filter((event) => event.message.length > 0)
    .sort((a, b) => a.at - b.at);

  return {
    function: fn.name,
    logGroup: fn.logGroup,
    events,
    note: events.length
      ? null
      : `Nothing in the last ${minutes} minute${minutes === 1 ? "" : "s"}${
          options.pattern ? ` matching "${options.pattern}"` : ""
        }.`,
  };
}
