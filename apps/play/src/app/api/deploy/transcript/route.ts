import { NextResponse } from "next/server";

import { currentRun, runTranscript } from "@/server/run";

/**
 * One step's transcript, after the fact.
 *
 * The live stream carries the lines while a run is going. This is the other
 * half: a page opened after a deploy finished has the steps and their notes —
 * which is what a collapsed row needs — and fetches the lines only for the step
 * somebody actually opens.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stepId = url.searchParams.get("step");
  const runId = url.searchParams.get("run");

  const run = currentRun();
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

  return NextResponse.json({ run: run.id, step: stepId, lines: runTranscript(run.id, stepId) });
}
