import { NextResponse } from "next/server";

import type { EnvironmentSettingsInput } from "@/lib/types";
import {
  googleOAuthValues,
  googleSecretStatus,
  readSettings,
  saveSettings,
  settingsContext,
} from "@/server/settings";

/**
 * One environment's settings — read them, write them.
 *
 * `GET` never returns the secret's value, only whether one is stored. `PUT`
 * accepts one and sends it to Secrets Manager; it is write-only in both
 * directions, which is why the form has to be told "a secret is set" rather
 * than being handed the secret to prefill.
 */

export const dynamic = "force-dynamic";

type Params = { params: { stage: string } };

export async function GET(_request: Request, { params }: Params) {
  const ctx = settingsContext();
  const settings = readSettings(params.stage);

  if (!settings) {
    return NextResponse.json(
      {
        error:
          `There is no infra/config/play-${params.stage}.json yet. Deploy ${params.stage} once — ` +
          "its third step writes the file — and then set these values.",
      },
      { status: 404 },
    );
  }

  settings.googleClientSecretSet = await googleSecretStatus(params.stage, ctx);
  settings.oauth = await googleOAuthValues(params.stage, ctx);
  return NextResponse.json({ settings });
}

export async function PUT(request: Request, { params }: Params) {
  let body: EnvironmentSettingsInput;
  try {
    body = (await request.json()) as EnvironmentSettingsInput;
  } catch {
    return NextResponse.json({ error: "The request body was not JSON." }, { status: 400 });
  }

  if (!body?.auth || !body?.mail) {
    return NextResponse.json(
      { error: "Expected an 'auth' and a 'mail' block." },
      { status: 400 },
    );
  }

  try {
    const settings = await saveSettings(params.stage, body, settingsContext());
    return NextResponse.json({ settings });
  } catch (error) {
    // A validation problem is the user's to fix and reads as a sentence; a CLI
    // failure is ours and arrives with the CLI's own last lines.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
