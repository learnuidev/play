import type { DeployEvent } from "@/lib/types";
import { backlog, currentRun, subscribe } from "@/server/run";

/**
 * The deploy's transcript, as it happens.
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
 * `/api/deploy/transcript`, because replaying thirteen steps of `cdk deploy`
 * output on every page load is a megabyte spent to draw a collapsed row.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keeps a proxy from closing an idle stream during a long CloudFormation wait. */
const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  const run = currentRun();

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
        const events = backlog(run.id);
        for (const event of events) {
          // Lines only for a going concern; the rest is a fetch away.
          if (event.type === "log" && run.status !== "running") continue;
          send(event);
        }
        if (run.status === "running") {
          unsubscribe = subscribe(run.id, send);
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
