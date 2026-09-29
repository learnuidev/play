"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DeployEvent, LogLine, RunView, StepView } from "@/lib/types";

/**
 * The deploy, as the page sees it.
 *
 * Three sources, and each has a job:
 *
 * - the run endpoint once on mount, so a console opened while a run is going —
 *   or reopened after one finished — draws it instead of an empty checklist;
 * - its `/events` stream for everything after that, which is the lines;
 * - its `/transcript` route for one step's lines when the run is over, because
 *   the live stream deliberately does not replay a finished transcript in full.
 *
 * ## One hook, two runs
 *
 * `base` is the only difference between the backend's deploy and a frontend's:
 * `/api/deploy` and `/api/vercel/deploy` answer the same three questions in the
 * same three shapes, because `server/run.ts` is one engine. A second hook would
 * be a second place where the line buffering, the step selection and the
 * reconnect-when-a-run-starts are subtlely different.
 *
 * ## Why the lines are batched
 *
 * `cdk deploy` emits a few hundred lines in a burst and a Next build emits more.
 * One React state update per line is a few hundred renders of a list, which is
 * the difference between a transcript that flows and one that stutters — so lines
 * land in a buffer and are flushed on an animation frame, which caps it at sixty
 * renders a second however fast the lines arrive.
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
  /** Starts a run. The body is the route's own — a stage, or a Vercel target. */
  start: (body: unknown) => Promise<string | null>;
  stop: () => Promise<void>;
  starting: boolean;
  /** A line of explanation for whatever just went wrong. */
  error: string | null;
  dismissError: () => void;
}

const EMPTY = new Map<string, DeployLine[]>();

/** Where a run's three endpoints live. The default is the backend's. */
export const BACKEND_RUN = "/api/deploy";
export const FRONTEND_RUN = "/api/vercel/deploy";

export function useDeploy(base: string = BACKEND_RUN): DeployState {
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
    const events = new EventSource(`${base}/events`);

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
  }, [base, push]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(base, { cache: "no-store" });
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
          `${base}/transcript?run=${encodeURIComponent(runId)}&step=${encodeURIComponent(selected)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { lines: LogLine[] };
        for (const line of body.lines) push({ ...line, stepId: selected });
      } catch {
        // A transcript that will not load is a collapsed row, not a failure.
      }
    })();
  }, [base, runId, selected, running, lines, push]);

  /* ---------------------------------------------------------------- *
   * Starting and stopping
   * ---------------------------------------------------------------- */

  const start = useCallback(
    async (body: unknown): Promise<string | null> => {
      setStarting(true);
      setError(null);
      try {
        const response = await fetch(base, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as { run?: RunView; error?: string };
        if (!response.ok) {
          setError(payload.error ?? `The run could not start (HTTP ${response.status}).`);
          return payload.error ?? null;
        }
        if (payload.run) {
          // A new run: everything the page is holding belongs to the old one.
          setLines(new Map());
          fetched.current = new Set();
          buffer.current = [];
          setFollowing(true);
          setSelected(null);
          setRun(payload.run);
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
    [base, open],
  );

  const stop = useCallback(async () => {
    try {
      await fetch(base, { method: "DELETE" });
    } catch {
      setError("The run could not be stopped. It may still be going.");
    }
  }, [base]);

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
