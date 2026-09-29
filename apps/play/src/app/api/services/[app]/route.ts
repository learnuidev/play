import { NextResponse } from "next/server";

import type { AppKey } from "@/lib/types";
import { consoleDefaults, listStages } from "@/server/environments";
import { appDefinition } from "@/server/repo";
import { portInUse, startService, stopService } from "@/server/services";

/**
 * Starting and stopping one frontend.
 *
 * `POST` starts it with a specific environment; `DELETE` stops it. The stage is
 * validated rather than trusted: it becomes a stack-name suffix on the way to
 * `describe-stacks`, and a stage nobody has a config for is a start that fails
 * with a sentence about the environment rather than one about a CLI.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: { app: string } };

function resolveApp(value: string): AppKey | null {
  const definition = appDefinition(value);
  return definition ? definition.key : null;
}

export async function POST(request: Request, { params }: Params) {
  const app = resolveApp(params.app);
  if (!app) {
    return NextResponse.json(
      { error: `'${params.app}' is not one of the apps this console starts.` },
      { status: 404 },
    );
  }

  let stage: string | null = null;
  try {
    const body = (await request.json()) as { stage?: unknown };
    if (typeof body.stage === "string" && body.stage.trim()) stage = body.stage.trim();
  } catch {
    // An empty body is "start it against its own .env.local", which is the
    // default and not an error.
  }

  if (stage !== null) {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(stage)) {
      return NextResponse.json({ error: `'${stage}' is not a stage name.` }, { status: 400 });
    }
    if (!listStages().includes(stage)) {
      return NextResponse.json(
        {
          error: `No environment '${stage}' — there is no infra/config/play-${stage}.json to read its API from.`,
        },
        { status: 404 },
      );
    }
  }

  const definition = appDefinition(app)!;
  if (await portInUse(definition.port)) {
    return NextResponse.json(
      {
        error: `Port ${definition.port} is already in use by something the console did not start. Free it, then try again.`,
      },
      { status: 409 },
    );
  }

  const { profile, region } = consoleDefaults();

  try {
    const service = await startService({ app, stage, profile, region });
    return NextResponse.json({ service }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const app = resolveApp(params.app);
  if (!app) {
    return NextResponse.json(
      { error: `'${params.app}' is not one of the apps this console starts.` },
      { status: 404 },
    );
  }
  const service = stopService(app);
  return NextResponse.json({ service });
}
