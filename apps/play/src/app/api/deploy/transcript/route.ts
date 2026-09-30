import { transcriptResponse } from "@/server/run-api";

/**
 * One step's lines, after the fact — `/api/deploy/transcript?stage=…`.
 *
 * A page opened after a deploy finished has the steps and their notes, which is
 * what a collapsed row needs; the lines are fetched only for the step somebody
 * opens. `server/run-api.ts` has the rest.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const stage = new URL(request.url).searchParams.get("stage")?.trim() ?? "";
  return transcriptResponse("backend", stage, request);
}
