import type { BackendFunctionView, BackendLogs, LogEventView } from "@/lib/types";
import { awsJson } from "./aws";

/**
 * The backend's logs, read out of CloudWatch.
 *
 * Every Lambda here logs to `/aws/lambda/play-<stage>-<key>` — the name is
 * derived rather than discovered, because `api-stack.ts` sets `functionName` and
 * CloudWatch names the group after it.
 *
 * ## Why the list is log groups and not functions
 *
 * It was `lambda list-functions`, filtered by name in this process — and that
 * was **wrong in a way nothing said out loud**: the call is paginated
 * account-wide, so a stage's Lambdas were only listed if they happened to fall
 * in the first page. On an account with a few hundred functions in it, `dev`'s
 * 163 came back as 80, and the missing half of the alphabet simply was not
 * there to search for.
 *
 * `DescribeLogGroups` takes a **name prefix**, and the prefix is the stage:
 * one call, filtered by the service rather than by this process, and complete
 * whatever else the account holds. It is also the more honest source for this
 * tab, which reads logs and nothing else — a function the console has no log
 * group for is a function it cannot show you anything about. The trade is that a
 * function which has **never been invoked** has no log group yet, unless the
 * stack declared one; that function has no logs to read either, so what is lost
 * is a row saying "nothing" rather than a row that works.
 *
 * Each row also carries how many bytes of log data the group holds, which is
 * the one number this list can offer that nothing else can: it is how you find
 * the function that is filling CloudWatch up.
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

interface RawLogGroup {
  logGroupName?: string;
  storedBytes?: number;
  retentionInDays?: number;
}

/**
 * How many log groups are read in one go.
 *
 * The API answers fifty at a time and the CLI's own paginator walks the pages
 * inside this one process, so this is the ceiling on a stage's function count
 * rather than a page size — well above the ~165 this repository deploys, and
 * there is no server-side way to ask for "all of them" that is cheaper.
 */
const MAX_GROUPS = 1000;

export async function backendFunctions(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<BackendFunctionView[]> {
  const logGroupPrefix = `/aws/lambda/play-${stage}-`;

  const body = await awsJson<{ logGroups?: RawLogGroup[] }>(
    [
      "logs",
      "describe-log-groups",
      "--log-group-name-prefix",
      logGroupPrefix,
      "--max-items",
      String(MAX_GROUPS),
    ],
    { ...ctx, optional: true },
  ).catch(() => null);

  if (!body) return [];

  return (body.logGroups ?? [])
    .filter((group): group is RawLogGroup & { logGroupName: string } =>
      Boolean(group.logGroupName?.startsWith(logGroupPrefix)),
    )
    .map((group) => {
      const key = group.logGroupName.slice(logGroupPrefix.length);
      return {
        name: `play-${stage}-${key}`,
        key,
        logGroup: group.logGroupName,
        storedBytes: group.storedBytes ?? 0,
        retentionDays: group.retentionInDays ?? null,
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
 * The two lines Lambda's runtime writes around every invocation.
 *
 * `START RequestId: … Version: $LATEST` and `END RequestId: …` say nothing the
 * page does not already know — the invocation's own line carries the same id,
 * and the report carries the outcome — and on a busy function they are about
 * forty per cent of a page. Excluding them is not cosmetic: the page holds 200
 * events, so a fifth of it being bookends is the difference between reading one
 * invocation and reading several.
 *
 * **Filtered in CloudWatch rather than hidden here**, so the slots are spent on
 * lines somebody can use. The syntax is two plain exclusion terms, which is the
 * documented way to say "must not contain"; the price is that a handler which
 * prints the literal word `START` in capitals loses that line too.
 */
const PLATFORM_LINES = ["-START", "-END"];

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
  // The platform's bookends are excluded from every read — see `PLATFORM_LINES`.
  argv.push(
    "--filter-pattern",
    [options.pattern?.trim(), ...PLATFORM_LINES].filter(Boolean).join(" "),
  );

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
