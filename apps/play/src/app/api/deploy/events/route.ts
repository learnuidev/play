import { eventsResponse } from "@/server/run-api";

/**
 * The deploy's transcript, as it happens — `/api/deploy/events`.
 *
 * The stream itself is shared with the frontend deploy's, and `server/run-api.ts`
 * is where its shape and the reasoning behind it are written down.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return eventsResponse("backend", request);
}
