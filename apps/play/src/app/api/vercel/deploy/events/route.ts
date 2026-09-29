import { eventsResponse } from "@/server/run-api";

/**
 * The frontend deploy's transcript, as it happens.
 *
 * A build is minutes of Vercel saying nothing and then a few hundred lines of
 * `npm install` and `next build`. That is exactly what the shared stream in
 * `server/run-api.ts` is for, and it is the same stream the backend deploy uses.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return eventsResponse("frontend", request);
}
