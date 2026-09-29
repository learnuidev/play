import { NextResponse } from "next/server";

import { cancelRun, currentRun, isRunning, startDeploy } from "@/server/run";
import { consoleDefaults } from "@/server/environments";
import { listStages } from "@/server/environments";

/**
 * The deploy — one at a time, and the reason why is in `server/run.ts`.
 *
 * `GET` is what the page polls once when it loads, so a console opened while a
 * deploy is running shows it rather than an empty checklist. Everything after
 * that arrives on the event stream.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ run: currentRun(), running: isRunning() });
}

export async function POST(request: Request) {
  let stage: string;
  try {
    const body = (await request.json()) as { stage?: unknown };
    if (typeof body.stage !== "string" || !body.stage.trim()) {
      throw new Error("a stage is required");
    }
    stage = body.stage.trim();
  } catch {
    return NextResponse.json(
      { error: "Expected a JSON body of the shape { stage: string }." },
      { status: 400 },
    );
  }

  // The stage becomes a `--context` value, a filename and a stack-name suffix.
  // A path separator or a space in it is a file written somewhere else, so the
  // shape is checked here rather than trusted to the three places it lands.
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(stage)) {
    return NextResponse.json(
      {
        error: `'${stage}' is not a stage name. Use lower-case letters, digits and dashes — it becomes a stack-name suffix and a config filename.`,
      },
      { status: 400 },
    );
  }

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

export async function DELETE() {
  const run = currentRun();
  if (!run || !isRunning()) {
    return NextResponse.json({ error: "Nothing is running." }, { status: 409 });
  }
  cancelRun(run.id);
  return NextResponse.json({ ok: true });
}
