import { transcriptResponse } from "@/server/run-api";

/**
 * One step's lines, after the fact — the frontend deploy's half.
 *
 * A page opened after a build finished has the steps and their notes; the lines
 * are fetched only for the step somebody opens, which for a failed build is the
 * one that says why.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const app = new URL(request.url).searchParams.get("app")?.trim() ?? "";
  return transcriptResponse("frontend", app, request);
}
