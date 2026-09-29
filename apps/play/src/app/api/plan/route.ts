import { NextResponse } from "next/server";

import { previewSteps } from "@/server/run";

/**
 * The plan, before it runs.
 *
 * The deploy page draws the checklist from a run when there is one, and from
 * this when there is not — which is most of the time. The point of showing it
 * *before* the button is pressed is that a checklist nobody can read until it
 * has already happened is not a checklist; it is a log.
 *
 * Only the four static fields cross the wire. The `check` and `apply` functions
 * are the server's, and stay there: the browser is told what will be attempted,
 * never how.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const stage = new URL(request.url).searchParams.get("stage") ?? "dev";
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(stage)) {
    return NextResponse.json({ error: `'${stage}' is not a stage name.` }, { status: 400 });
  }

  return NextResponse.json({ stage, steps: previewSteps(stage) });
}
