import { NextResponse } from "next/server";

import { cancelRun, currentRun, isRunning, startDeploy } from "@/server/run";
import { stageFromBody } from "@/server/run-api";
import { consoleDefaults, listStages } from "@/server/environments";

/** The backend's run — the frontend's is `/api/vercel/deploy`. */
const KIND = "backend" as const;

/**
 * The deploy — one environment at a time, and the reasons are in `server/run.ts`.
 *
 * `GET` is what the page polls once when it loads, so a console opened while a
 * deploy is running shows it rather than an empty checklist. Everything after
 * that arrives on the event stream.
 *
 * **The environment is a parameter, not an assumption.** Two stages can be
 * deploying at once, so every one of these reads and writes the run of the stage
 * it names: a `GET` without one would answer with an arbitrary deploy, and the
 * page would draw another environment's steps under this environment's name.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The stage this request is about, or the sentence saying there is none. */
function stageOf(request: Request): string | null {
  return new URL(request.url).searchParams.get("stage")?.trim() || null;
}

const NO_STAGE =
  "Expected ?stage=<environment> — a backend run belongs to one environment, and more than one can be going at once.";

export async function GET(request: Request) {
  const stage = stageOf(request);
  if (!stage) return NextResponse.json({ error: NO_STAGE }, { status: 400 });

  return NextResponse.json({ run: currentRun(KIND, stage), running: isRunning(KIND, stage) });
}

export async function POST(request: Request) {
  const parsed = await stageFromBody(request);
  if (parsed instanceof NextResponse) return parsed;
  const { stage } = parsed;

  if (!listStages().includes(stage)) {
    // Not a refusal: a stage that does not exist yet is precisely what this
    // button is for. It is a note in the transcript, and the config step is
    // where it gets a file.
    void stage;
  }

  const { profile, region } = consoleDefaults();

  try {
    const run = startDeploy({ stage, profile, region });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const stage = stageOf(request);
  if (!stage) return NextResponse.json({ error: NO_STAGE }, { status: 400 });

  const run = currentRun(KIND, stage);
  if (!run || !isRunning(KIND, stage)) {
    return NextResponse.json(
      { error: `Nothing is running against '${stage}'.` },
      { status: 409 },
    );
  }
  cancelRun(KIND, stage, run.id);
  return NextResponse.json({ ok: true });
}
