import type { FunctionMetrics, MetricBucket } from "@/lib/types";
import { type MetricRange } from "@/lib/ranges";
import { awsJson } from "./aws";

/**
 * What a function has been doing, out of CloudWatch.
 *
 * ## Three metrics, because they answer three questions
 *
 * `Invocations` says whether it is running at all, `Errors` says whether it is
 * working, and `Duration`'s **p95** says whether it is fast enough — which is the
 * only one of the three a log line cannot answer, since a slow invocation and a
 * fast one look identical in a transcript. An average would hide exactly the
 * tail that a p95 is for.
 *
 * ## Why the series are filled in
 *
 * CloudWatch answers with the periods it has data for and **omits the rest** —
 * a quiet slot is absent rather than zero. Drawn as-is, an hour of nothing
 * between two busy minutes would collapse into no width at all, and a chart of
 * "is this being called" that cannot show an idle hour is not a chart of
 * anything. So the buckets are laid out end to end first — one per period, all
 * of them — and the datapoints are dropped into their slots.
 *
 * `durationP95` is `null` in a quiet slot rather than `0`. Zero invocations is
 * not a fast response, and a line dipping to the floor is a chart telling a
 * story about latency that did not happen.
 *
 * The windows themselves — and the period each is read at — are `lib/ranges`,
 * because the buttons that choose one are drawn by a client component and this
 * module runs the query behind it.
 */

interface RawDatapoint {
  Timestamp?: string;
  Sum?: number;
  ExtendedStatistics?: Record<string, number>;
}

interface RawMetric {
  Datapoints?: RawDatapoint[];
}

/**
 * One metric's datapoints, keyed by the slot they belong in.
 *
 * `--statistics` and `--extended-statistics` are asked for separately because
 * they are different queries: a Sum is a Sum, and a p95 only exists as an
 * extended statistic. The caller says which it wants and this returns a map from
 * bucket start to value.
 */
async function datapoints(
  fn: string,
  metric: string,
  range: MetricRange,
  statistic: { sum?: true; p95?: true },
  ctx: { profile?: string; region?: string },
): Promise<Map<number, number>> {
  const end = Date.now();
  const start = end - range.minutes * 60_000;

  const argv = [
    "cloudwatch",
    "get-metric-statistics",
    "--namespace",
    "AWS/Lambda",
    "--metric-name",
    metric,
    "--dimensions",
    `Name=FunctionName,Value=${fn}`,
    "--start-time",
    new Date(start).toISOString(),
    "--end-time",
    new Date(end).toISOString(),
    "--period",
    String(range.periodSeconds),
  ];
  if (statistic.sum) argv.push("--statistics", "Sum");
  if (statistic.p95) argv.push("--extended-statistics", "p95");

  const body = await awsJson<RawMetric>(argv, { ...ctx, optional: true }).catch(() => null);

  const points = new Map<number, number>();
  for (const point of body?.Datapoints ?? []) {
    if (!point.Timestamp) continue;
    const value = statistic.sum ? point.Sum : point.ExtendedStatistics?.p95;
    if (typeof value !== "number") continue;
    // CloudWatch returns the datapoint's own timestamp, which is the bucket's
    // start. It is rounded to the period so that the three series land in the
    // same slots even if one of them answers a second off.
    points.set(alignTo(Date.parse(point.Timestamp), range.periodSeconds), value);
  }
  return points;
}

/** A timestamp snapped down to the bucket it belongs to. */
function alignTo(at: number, periodSeconds: number): number {
  const size = periodSeconds * 1000;
  return Math.floor(at / size) * size;
}

export async function functionMetrics(
  stage: string,
  fn: string,
  range: MetricRange,
  ctx: { profile?: string; region?: string } = {},
): Promise<FunctionMetrics> {
  // Three reads at once: they are the same question asked of three metrics, and
  // doing them in sequence would make the card's spinner three times as long.
  const [invocations, errors, durations] = await Promise.all([
    datapoints(fn, "Invocations", range, { sum: true }, ctx),
    datapoints(fn, "Errors", range, { sum: true }, ctx),
    datapoints(fn, "Duration", range, { p95: true }, ctx),
  ]);

  const now = alignTo(Date.now(), range.periodSeconds);
  const size = range.periodSeconds * 1000;
  const buckets: MetricBucket[] = [];

  // Oldest first, one slot per period, all of them present.
  for (let at = now - range.minutes * 60_000 + size; at <= now; at += size) {
    buckets.push({
      at,
      invocations: invocations.get(at) ?? 0,
      errors: errors.get(at) ?? 0,
      durationP95: durations.get(at) ?? null,
    });
  }

  const called = buckets.filter((bucket) => bucket.invocations > 0);
  const totalErrors = buckets.reduce((sum, bucket) => sum + bucket.errors, 0);
  const worst = called.reduce<number | null>(
    (highest, bucket) =>
      bucket.durationP95 === null ? highest : Math.max(highest ?? 0, bucket.durationP95),
    null,
  );

  return {
    function: fn,
    minutes: range.minutes,
    periodSeconds: range.periodSeconds,
    buckets,
    totals: {
      invocations: buckets.reduce((sum, bucket) => sum + bucket.invocations, 0),
      errors: totalErrors,
      durationP95: worst,
    },
    note: called.length
      ? null
      : `${fn} has not been invoked in the last ${range.label} — CloudWatch has no datapoints, and ` +
        `nothing has written a log line either. A function that has never been called has no metrics at all.`,
  };
}
