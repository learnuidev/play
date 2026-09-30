import { eventsResponse } from "@/server/run-api";

/**
 * The deploy's transcript, as it happens — `/api/deploy/events?stage=<stage>`.
 *
 * The stream itself is shared with the frontend deploy's, and `server/run-api.ts`
 * is where its shape and the reasoning behind it are written down.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const stage = new URL(request.url).searchParams.get("stage")?.trim() ?? "";
  return eventsResponse("backend", stage, request);
}
