/**
 * The windows the console offers, and the bucket each one is read at.
 *
 * One list, because two things depend on it and they must agree: the range
 * buttons on the Activity card, and the period `get-metric-statistics` is asked
 * for — CloudWatch answers at most 1440 datapoints, so an hour is read a minute
 * at a time and a week an hour at a time. A window the page offers and the
 * server cannot draw would be a button that fails; a period chosen in two
 * places would be a chart whose bars are not the width its own label says.
 *
 * The logs below the chart are read over the same window, which is why this is
 * a range and not just a metric period: "what did this function do" and "what
 * did it say" are one question asked twice.
 *
 * Plain data in `lib/`, like `backends.ts` and `frontends.ts`, because a client
 * component draws the buttons and a server module runs the queries.
 */

export interface MetricRange {
  id: string;
  /** What the button says. */
  label: string;
  minutes: number;
  /** How wide one bar is, in seconds. */
  periodSeconds: number;
}

export const METRIC_RANGES: MetricRange[] = [
  { id: "1h", label: "1h", minutes: 60, periodSeconds: 60 },
  { id: "3h", label: "3h", minutes: 180, periodSeconds: 300 },
  { id: "24h", label: "24h", minutes: 1440, periodSeconds: 900 },
  { id: "7d", label: "7d", minutes: 10080, periodSeconds: 3600 },
];

export const DEFAULT_RANGE = METRIC_RANGES[1];

/**
 * The range a number of minutes names.
 *
 * Anything else is the default rather than an error: the value arrives in a
 * query string, and a window that is not on this list is a period CloudWatch
 * would either refuse or stretch — so a made-up one falls back to something
 * real, which is the same rule `useTabParam` applies to an unknown tab.
 */
export function rangeFor(minutes: number): MetricRange {
  return METRIC_RANGES.find((range) => range.minutes === minutes) ?? DEFAULT_RANGE;
}

/** `60` → `1 hour`, `1440` → `24 hours`. For a sentence rather than a button. */
export function windowLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  return days === 1 ? "24 hours" : `${days} days`;
}
