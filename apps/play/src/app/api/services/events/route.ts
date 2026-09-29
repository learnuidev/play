import type { ServiceEvent } from "@/lib/types";
import { servicesBacklog, subscribeServices } from "@/server/services";

/**
 * All three frontends on one stream.
 *
 * The cards share a page, so they share a connection: three `EventSource`s to
 * say three things would be three reconnects to get wrong, and the backlog for
 * a card that has not started yet is empty anyway.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

      const send = (event: ServiceEvent) => write(`data: ${JSON.stringify(event)}\n\n`);

      for (const event of servicesBacklog()) send(event);
      unsubscribe = subscribeServices(send);
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
