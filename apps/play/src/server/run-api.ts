import { NextResponse } from "next/server";

import type { DeployEvent, RunKind } from "@/lib/types";
import { backlog, currentRun, runTranscript, subscribe } from "./run";

/**
 * The two halves of a run's transcript, as both kinds of run serve them.
 *
 * A backend run and a frontend run have their own routes — `/api/deploy/*` and
 * `/api/vercel/deploy/*` — because they are different pages with different
 * bodies on the way in. What they *answer* is identical, and it is identical
 * for a reason worth stating: one step's transcript after the fact, and every
 * line as it happens, are the whole contract between a run and a browser. Two
 * implementations of that contract would be two chances for a stream to lose a
 * line in one place and not the other.
 */

/** Keeps a proxy from closing an idle stream during a long CloudFormation wait. */
const HEARTBEAT_MS = 15_000;

/**
 * One step's lines, after the fact.
 *
 * The live stream carries the lines while a run is going. This is the other
 * half: a page opened after a deploy finished has the steps and their notes —
 * which is what a collapsed row needs — and fetches the lines only for the step
 * somebody actually opens.
 */
export function transcriptResponse(kind: RunKind, request: Request): NextResponse {
  const url = new URL(request.url);
  const stepId = url.searchParams.get("step");
  const runId = url.searchParams.get("run");

  const run = currentRun(kind);
  if (!run) {
    return NextResponse.json({ error: "No run to read." }, { status: 404 });
  }
  if (runId && runId !== run.id) {
    return NextResponse.json(
      { error: "That run is no longer in memory. Runs are kept until the console restarts." },
      { status: 404 },
    );
  }
  if (!stepId) {
    return NextResponse.json({ error: "Expected ?step=<id>." }, { status: 400 });
  }
  if (!run.steps.some((step) => step.id === stepId)) {
    return NextResponse.json({ error: `No step '${stepId}' in this run.` }, { status: 404 });
  }

  return NextResponse.json({
    run: run.id,
    step: stepId,
    lines: runTranscript(kind, run.id, stepId),
  });
}

/**
 * The transcript, as it happens.
 *
 * Server-sent events rather than a WebSocket, and rather than polling. The
 * traffic is one-way and bursty — nothing for forty seconds, then four hundred
 * lines from `cdk deploy` — which is exactly the shape SSE is good at, and a
 * `ReadableStream` in a route handler is the whole of the implementation. A
 * WebSocket would need a server the console does not otherwise have, and
 * polling would either miss lines or send them twice.
 *
 * ## What a subscriber gets
 *
 * The run and every step first, so a page that reloads mid-deploy redraws the
 * checklist immediately; then the lines buffered so far, but **only while the
 * run is going**. A finished run's transcript is fetched a step at a time from
 * the transcript route, because replaying fourteen steps of `cdk deploy` output
 * on every page load is a megabyte spent to draw a collapsed row.
 */
export function eventsResponse(kind: RunKind, request: Request): Response {
  const run = currentRun(kind);

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      const send = (event: DeployEvent | { type: "idle" }) => {
        write(`data: ${JSON.stringify(event)}\n\n`);
      };

      if (!run) {
        send({ type: "idle" });
        write(": no run\n\n");
      } else {
        const events = backlog(kind, run.id);
        for (const event of events) {
          // Lines only for a going concern; the rest is a fetch away.
          if (event.type === "log" && run.status !== "running") continue;
          send(event);
        }
        if (run.status === "running") {
          unsubscribe = subscribe(kind, run.id, send);
        }
      }

      heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      // Vercel's proxy buffers by default, which turns a live transcript into
      // one that arrives at the end.
      "x-accel-buffering": "no",
    },
  });
}
