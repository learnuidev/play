"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DeployEvent, LogLine, RunView, StepView } from "@/lib/types";

/**
 * The deploy, as the page sees it.
 *
 * Three sources, and each has a job:
 *
 * - `GET /api/deploy` once on mount, so a console opened while a run is going —
 *   or reopened after one finished — draws it instead of an empty checklist;
 * - `GET /api/deploy/events` for everything after that, which is the lines;
 * - `GET /api/deploy/transcript` for one step's lines when the run is over,
 *   because the live stream deliberately does not replay a finished transcript
 *   in full.
 *
 * ## Why the lines are batched
 *
 * `cdk deploy` emits a few hundred lines in a burst. One React state update per
 * line is a few hundred renders of a list, which is the difference between a
 * transcript that flows and one that stutters — so lines land in a buffer and
 * are flushed on an animation frame, which caps it at sixty renders a second
 * however fast the lines arrive.
 */

export interface DeployLine extends LogLine {
  stepId: string;
}

export interface DeployState {
  run: RunView | null;
  lines: Map<string, DeployLine[]>;
  /** `true` while the page is following the run's own step selection. */
  following: boolean;
  selected: string | null;
  select: (stepId: string | null) => void;
  start: (stage: string) => Promise<string | null>;
  stop: () => Promise<void>;
  starting: boolean;
  /** A line of explanation for whatever just went wrong. */
  error: string | null;
  dismissError: () => void;
}

const EMPTY = new Map<string, DeployLine[]>();

export function useDeploy(): DeployState {
  const [run, setRun] = useState<RunView | null>(null);
  const [lines, setLines] = useState<Map<string, DeployLine[]>>(EMPTY);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);

  const buffer = useRef<DeployLine[]>([]);
  const frame = useRef<number | null>(null);
  const source = useRef<EventSource | null>(null);
  /** Which run the client has already asked for a transcript of. */
  const fetched = useRef<Set<string>>(new Set());

  const flush = useCallback(() => {
    frame.current = null;
    if (buffer.current.length === 0) return;
    const incoming = buffer.current;
    buffer.current = [];
    setLines((current) => {
      const next = new Map(current);
      for (const line of incoming) {
        const existing = next.get(line.stepId);
        if (existing) next.set(line.stepId, [...existing, line]);
        else next.set(line.stepId, [line]);
      }
      return next;
    });
  }, []);

  const push = useCallback(
    (line: DeployLine) => {
      buffer.current.push(line);
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  /* ---------------------------------------------------------------- *
   * The stream
   * ---------------------------------------------------------------- */

  /**
   * (Re)opening the stream is not only a mount-time thing.
   *
   * The server subscribes a new connection to *the run that exists when it
   * connects*, and there is no run on a page that has just loaded. So a deploy
   * started from that page has to open a new connection to be followed — the
   * `POST` answers with the run, and everything after it arrives on a stream
   * that is now attached to something.
   */
  const open = useCallback(() => {
    source.current?.close();
    const events = new EventSource("/api/deploy/events");

    events.onmessage = (message) => {
      let event: DeployEvent | { type: "idle" };
      try {
        event = JSON.parse(message.data) as DeployEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case "run":
        case "end":
          setRun(event.run);
          break;
        case "step":
          setRun((current) =>
            current
              ? {
                  ...current,
                  steps: current.steps.map((step) =>
                    step.id === event.step.id ? event.step : step,
                  ),
                }
              : current,
          );
          break;
        case "log":
          push({ ...event.line, stepId: event.stepId });
          break;
        default:
          break;
      }
    };

    // `EventSource` reconnects on its own, and the handler that reopens it here
    // would double every line after a blip. The server's backlog is replayed on
    // reconnect, so the browser's own retry is the right one.
    events.onerror = () => {
      if (events.readyState === EventSource.CLOSED) {
        setError("The console lost its connection to the server. Refresh the page.");
      }
    };

    source.current = events;
  }, [push]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/deploy", { cache: "no-store" });
        if (!response.ok) return;
        const { run: current } = (await response.json()) as { run: RunView | null };
        if (!cancelled && current) setRun(current);
      } catch {
        // The stream below is the real source; a failed first read is a page
        // that fills in from the next line onwards, not an error worth a banner.
      }
    })();

    open();
    return () => {
      cancelled = true;
      source.current?.close();
      source.current = null;
    };
  }, [open]);

  /* ---------------------------------------------------------------- *
   * Selecting a step, and loading its transcript
   * ---------------------------------------------------------------- */

  // While a run is going, the transcript follows the step being worked on —
  // that is the step anybody watching wants. Clicking another one stops the
  // following until it is turned back on, so a reader is never dragged away
  // from what they were reading.
  const activeStep = run?.steps.find((step) => step.status === "running")?.id ?? null;
  useEffect(() => {
    if (following && activeStep) setSelected(activeStep);
  }, [following, activeStep]);

  useEffect(() => {
    if (selected) return;
    const first = run?.steps.find((step) => step.status !== "pending");
    if (first) setSelected(first.id);
  }, [run, selected]);

  const running = run?.status === "running";
  const runId = run?.id ?? null;

  useEffect(() => {
    if (!runId || !selected || running) return;
    if (lines.has(selected)) return;
    const key = `${runId}:${selected}`;
    if (fetched.current.has(key)) return;
    fetched.current.add(key);

    void (async () => {
      try {
        const response = await fetch(
          `/api/deploy/transcript?run=${encodeURIComponent(runId)}&step=${encodeURIComponent(selected)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { lines: LogLine[] };
        for (const line of body.lines) push({ ...line, stepId: selected });
      } catch {
        // A transcript that will not load is a collapsed row, not a failure.
      }
    })();
  }, [runId, selected, running, lines, push]);

  /* ---------------------------------------------------------------- *
   * Starting and stopping
   * ---------------------------------------------------------------- */

  const start = useCallback(
    async (stage: string): Promise<string | null> => {
      setStarting(true);
      setError(null);
      try {
        const response = await fetch("/api/deploy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stage }),
        });
        const body = (await response.json()) as { run?: RunView; error?: string };
        if (!response.ok) {
          setError(body.error ?? `The deploy could not start (HTTP ${response.status}).`);
          return body.error ?? null;
        }
        if (body.run) {
          // A new run: everything the page is holding belongs to the old one.
          setLines(new Map());
          fetched.current = new Set();
          buffer.current = [];
          setFollowing(true);
          setSelected(null);
          setRun(body.run);
          // And a stream that is attached to it rather than to the absence of
          // one it found when the page loaded.
          open();
        }
        return null;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        return message;
      } finally {
        setStarting(false);
      }
    },
    [open],
  );

  const stop = useCallback(async () => {
    try {
      await fetch("/api/deploy", { method: "DELETE" });
    } catch {
      setError("The run could not be stopped. It may still be going.");
    }
  }, []);

  const select = useCallback((stepId: string | null) => {
    setSelected(stepId);
    setFollowing(false);
  }, []);

  return {
    run,
    lines,
    selected,
    select,
    following,
    start,
    stop,
    starting,
    error,
    dismissError: () => setError(null),
  };
}

/** The steps to draw: the run's, or the preview's, or the run's for another stage. */
export function stepsFor(
  run: RunView | null,
  preview: StepView[] | null,
  stage: string,
): StepView[] {
  if (run && run.stage === stage) return run.steps;
  return preview ?? [];
}
