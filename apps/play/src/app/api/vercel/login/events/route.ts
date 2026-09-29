import type { VercelLoginEvent } from "@/lib/types";
import { subscribeVercelLogin, vercelLoginBacklog } from "@/server/vercel-cli";

/**
 * The sign-in's output, as it happens.
 *
 * The same shape as the deploy's stream, for the same reason: what comes back is
 * one-way and bursty — nothing while a package manager resolves, then the device
 * URL, then nothing at all while somebody walks to their browser — and a
 * `ReadableStream` in a route handler is the whole of the implementation.
 *
 * A subscriber that arrives late is handed the run and every line so far, which
 * is what makes a reload during a sign-in harmless: the page rejoins the flow
 * instead of showing an empty box beside a pending device code.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Long enough for an install, short enough to notice a dead connection. */
const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
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

      const send = (event: VercelLoginEvent) => write(`data: ${JSON.stringify(event)}\n\n`);

      for (const event of vercelLoginBacklog()) send(event);
      unsubscribe = subscribeVercelLogin(send);
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
      "x-accel-buffering": "no",
    },
  });
}
