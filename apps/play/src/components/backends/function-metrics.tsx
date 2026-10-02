"use client";

import { useCallback, useEffect, useState } from "react";
import { ActivityIcon, RefreshCwIcon } from "lucide-react";

import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { METRIC_RANGES, type MetricRange } from "@/lib/ranges";
import type { BackendFunctionView, FunctionMetrics, MetricBucket } from "@/lib/types";
/**
 * What one function has been doing, as a chart.
 *
 * ## Three series and two scales
 *
 * Invocations and errors are **counts** and share the left axis; duration's p95
 * is **milliseconds** and gets the right one. Drawing all three against one
 * scale is the mistake that makes these charts useless — a function taking 400 ms
 * would flatten every bar in the window to a line, or the bars would flatten the
 * latency to nothing — and it is the reason CloudWatch's own chart has two.
 *
 * ## Drawn here, not by a library
 *
 * A charting dependency is 40 kB to draw one small line and two bars, and the
 * console deliberately holds almost nothing. What is actually needed is
 * arithmetic: a bucket has an x from its time and a y from its value, and a bar
 * is a rectangle. Every colour comes from the same tokens as the rest of the
 * app, so the chart is the console's rather than a foreign object inside it.
 *
 * ## Colours mean what they mean everywhere else
 *
 * `run` for the latency line and `destructive` for the error bars — the same
 * tones the chips use — and invocations in the muted foreground, because "it ran"
 * is not news. A chart is where colour is most tempting and where it does most
 * damage: a page of coloured lines says nothing when every line is a different
 * colour for decoration.
 */

export function FunctionMetricsCard({
  stage,
  fn,
  range,
  onRangeChange,
}: {
  stage: string;
  /** The picked function, or null while the list is still being read. */
  fn: BackendFunctionView | null;
  range: MetricRange;
  onRangeChange: (range: MetricRange) => void;
}) {
  const [metrics, setMetrics] = useState<FunctionMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!fn) return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      function: fn.name,
      minutes: String(range.minutes),
    });

    fetch(`/api/backends/${encodeURIComponent(stage)}/metrics?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { metrics?: FunctionMetrics; error?: string };
        if (!response.ok || !body.metrics) {
          setError(body.error ?? "The metrics could not be read.");
          return;
        }
        setMetrics(body.metrics);
      })
      .catch(() => setError("The metrics could not be read."))
      .finally(() => setLoading(false));
  }, [stage, fn, range.minutes]);

  useEffect(() => {
    setMetrics(null);
    load();
  }, [load]);

  const totals = metrics?.totals;

  return (
    <Card>
      <CardHeading
        title="Activity"
        hint="CloudWatch's own numbers for this function: how often it ran, how often it failed, and how slow it got. An average would hide the tail, so the line is the 95th percentile."
        action={
          // The range belongs to this card and governs the logs below it as
          // well: "what did it do" and "what did it say" are the same question
          // asked over the same window, and two range controls would be two
          // answers to it — the second one always the wrong one.
          <div className="flex flex-wrap items-center gap-1">
            {METRIC_RANGES.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={option.id === range.id ? "primary" : "ghost"}
                aria-pressed={option.id === range.id}
                onClick={() => onRangeChange(option)}
              >
                {option.label}
              </Button>
            ))}
            <IconButton onClick={load} title="Refresh" aria-label="Refresh">
              <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            </IconButton>
          </div>
        }
      />

      {error ? (
        <p className="text-destructive mt-4 font-mono text-xs whitespace-pre-wrap">{error}</p>
      ) : !metrics ? (
        <p className="text-muted-foreground mt-4 text-xs">
          {fn ? "Reading the metrics…" : "Choose a function."}
        </p>
      ) : metrics.note ? (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
          <ActivityIcon className="size-3.5" />
          {metrics.note}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <Legend tone="muted" label="invocations">
              {totals?.invocations.toLocaleString()}
            </Legend>
            <Legend tone={totals?.errors ? "bad" : "muted"} label="errors">
              {totals?.errors.toLocaleString()}
              {totals && totals.invocations > 0
                ? ` (${((totals.errors / totals.invocations) * 100).toFixed(1)}%)`
                : ""}
            </Legend>
            <Legend tone="run" label="duration p95">
              {totals?.durationP95 === null || totals?.durationP95 === undefined
                ? "—"
                : `${Math.round(totals.durationP95)} ms`}
            </Legend>
            <span className="text-muted-foreground ml-auto">
              {range.label} · {Math.round(metrics.periodSeconds / 60)}m buckets
            </span>
          </div>

          <Chart buckets={metrics.buckets} periodSeconds={metrics.periodSeconds} />
        </>
      )}
    </Card>
  );
}

function Legend({
  tone,
  label,
  children,
}: {
  tone: "muted" | "run" | "bad";
  label: string;
  children: React.ReactNode;
}) {
  const dot = {
    muted: "bg-muted-foreground/50",
    run: "bg-run",
    bad: "bg-destructive",
  }[tone];

  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={`mt-1 inline-block size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{children}</span>
    </span>
  );
}

/**
 * The chart.
 *
 * A viewBox and `w-full`, so it is drawn once at a fixed coordinate space and
 * scaled by the browser — which is what makes it work at any card width without
 * a resize observer, and what keeps the line and the bars in proportion. The
 * height is fixed because a chart's height is a decision, not a measurement.
 */
const W = 800;
const H = 150;
const PAD = { top: 12, right: 46, bottom: 20, left: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function Chart({ buckets, periodSeconds }: { buckets: MetricBucket[]; periodSeconds: number }) {
  if (buckets.length === 0) return null;

  // Round the axes up to something a person can read: a 3-9-1 chart is precise
  // and useless, so the count axis is capped at a round number and the latency
  // axis at the next hundred milliseconds.
  const maxCount = niceCeil(Math.max(1, ...buckets.map((b) => b.invocations)));
  const latencies = buckets.map((b) => b.durationP95).filter((v): v is number => v !== null);
  const maxMs = niceCeil(Math.max(1, ...latencies));

  const slot = PLOT_W / buckets.length;
  const barW = Math.max(1.5, Math.min(slot * 0.6, 18));

  const x = (index: number) => PAD.left + index * slot + slot / 2;
  const yCount = (value: number) => PAD.top + PLOT_H - (value / maxCount) * PLOT_H;
  const yMs = (value: number) => PAD.top + PLOT_H - (value / maxMs) * PLOT_H;

  // The latency line, broken wherever nothing ran: it joins consecutive slots
  // with data and starts a new run anywhere a slot was empty, so an idle hour
  // is a gap in the line rather than a dive to the floor.
  const segments: string[] = [];
  let current: string[] = [];
  buckets.forEach((bucket, index) => {
    if (bucket.durationP95 === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length ? "L" : "M"} ${x(index).toFixed(1)} ${yMs(bucket.durationP95).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  const labelEvery = Math.max(1, Math.floor(buckets.length / 4));
  const timeLabel = (at: number) =>
    new Date(at).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-40 w-full"
        role="img"
        aria-label="Invocations, errors and p95 duration over the selected window"
      >
        {/* The baseline and the top of the count axis: two hairlines are enough
            to read a value against, and a full grid is furniture. */}
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={PAD.top + PLOT_H}
          y2={PAD.top + PLOT_H}
          className="stroke-border"
          strokeWidth="1"
        />
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={PAD.top}
          y2={PAD.top}
          className="stroke-border/40"
          strokeWidth="1"
          strokeDasharray="2 4"
        />

        {buckets.map((bucket, index) => {
          const centre = x(index);
          const top = yCount(bucket.invocations);
          const errorTop = yCount(bucket.errors);
          const hover = `${timeLabel(bucket.at)} — ${bucket.invocations} invocation${
            bucket.invocations === 1 ? "" : "s"
          }${bucket.errors ? `, ${bucket.errors} error${bucket.errors === 1 ? "" : "s"}` : ""}${
            bucket.durationP95 === null ? "" : `, p95 ${Math.round(bucket.durationP95)} ms`
          }`;

          return (
            <g key={bucket.at}>
              {bucket.invocations > 0 ? (
                <rect
                  x={centre - barW / 2}
                  y={top}
                  width={barW}
                  height={Math.max(1, PAD.top + PLOT_H - top)}
                  rx={1.5}
                  className="fill-muted-foreground/30"
                />
              ) : null}
              {/* Errors are drawn inside the invocation bar rather than beside
                  it: they are a subset of it, and two bars per slot would read
                  as two independent series that happen to be adjacent. */}
              {bucket.errors > 0 ? (
                <rect
                  x={centre - barW / 2}
                  y={errorTop}
                  width={barW}
                  height={Math.max(1, PAD.top + PLOT_H - errorTop)}
                  rx={1.5}
                  className="fill-destructive"
                />
              ) : null}
              {/* The hover target is the whole slot, so the tooltip does not
                  depend on hitting a two-pixel bar. */}
              <rect x={centre - slot / 2} y={PAD.top} width={slot} height={PLOT_H} fill="transparent">
                <title>{hover}</title>
              </rect>
            </g>
          );
        })}

        {segments.map((path) => (
          <path
            key={path}
            d={path}
            fill="none"
            className="stroke-run"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Axis labels: the maximum of each scale, and the time at each end. */}
        <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="fill-muted-foreground text-xs">
          {maxCount}
        </text>
        <text
          x={PAD.left - 6}
          y={PAD.top + PLOT_H + 4}
          textAnchor="end"
          className="fill-muted-foreground text-xs"
        >
          0
        </text>
        <text x={W - PAD.right + 6} y={PAD.top + 4} className="fill-muted-foreground text-xs">
          {maxMs} ms
        </text>
        <text
          x={PAD.left}
          y={H - 4}
          className="fill-muted-foreground text-xs"
        >
          {timeLabel(buckets[0].at)}
        </text>
        {buckets.length > 2 ? (
          <text
            x={PAD.left + PLOT_W}
            y={H - 4}
            textAnchor="end"
            className="fill-muted-foreground text-xs"
          >
            {timeLabel(buckets[buckets.length - 1].at + periodSeconds * 1000)}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

/**
 * A scale's top, rounded up to something readable.
 *
 * 9 becomes 10 and 37 becomes 40, so the axis labels are numbers a person can
 * hold in their head — and so the top of the chart is never a value that only
 * exists because of which bucket happened to be the busiest.
 */
function niceCeil(value: number): number {
  // Small maxima are left alone: an axis reading "5" over a single invocation
  // is a chart that looks broken, and there is nothing to round at this size.
  if (value <= 5) return Math.max(1, Math.ceil(value));
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}
