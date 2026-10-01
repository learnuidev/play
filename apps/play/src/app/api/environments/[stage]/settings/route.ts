import { NextResponse } from "next/server";

import type { EnvironmentSettingsInput } from "@/lib/types";
import {
  googleOAuthValues,
  googleSecretStatus,
  readSettings,
  saveSettings,
  settingsContext,
  stripeState,
} from "@/server/settings";
import { signingKeyState } from "@/server/signing-key";

/**
 * One environment's settings — read them, write them.
 *
 * `GET` never returns the secret's value, only whether one is stored. `PUT`
 * accepts one and sends it to Secrets Manager; it is write-only in both
 * directions, which is why the form has to be told "a secret is set" rather
 * than being handed the secret to prefill. The *publishable* Stripe key is the
 * exception and is read back, because it is not a secret: it is the key a
 * browser loads Stripe.js with.
 *
 * ## `PUT` reaches the live pool, not only the file
 *
 * The callback and logout URLs are the one part of a save whose effect is not a
 * file: a stage that imports its pool has no deploy that can change the URL
 * lists Cognito accepts, so `saveSettings` runs
 * `services/api/scripts/set-auth-urls.mjs` against this stage's own lists. What
 * that found is `write.authUrls`, and a stage with no pool yet answers with a
 * sentence rather than a failure — `server/auth-urls.ts` has the reasoning.
 *
 * ## A stage with no config file gets a draft, not a 404
 *
 * That stage is a **new environment**, and these settings are exactly what it
 * needs first: its user pool is built from the Google client id and secret, so
 * there is nothing to deploy until somebody has supplied them. `GET` therefore
 * answers with the product's own values under this stage's name — the mail
 * addresses, the client id, the callback URLs, carried over from a stage that
 * has them — and `PUT` is what writes the file.
 *
 * That is also why the response carries the **signing key's** state: it is the
 * other thing a first deploy cannot run without, and the one piece of it that is
 * generated rather than typed. A 404 therefore means something narrower than it
 * used to — no file here, **and** no other stage's file to take the product
 * settings from.
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
          `There is no infra/config/play-${params.stage}.json yet, and no completed config to take ` +
          "the product settings from. Write one by hand — it is the file that says what this " +
          "environment creates or imports — and then set these values.",
      },
      { status: 404 },
    );
  }

  settings.googleClientSecretSet = await googleSecretStatus(params.stage, ctx);
  settings.oauth = await googleOAuthValues(params.stage, ctx, settings.account);
  // Including the webhook URL, which only exists once the payment stack has been
  // deployed — so this is also the read that says whether it has been.
  settings.stripe = await stripeState(params.stage, ctx);

  // A signing-key read that fails is not a broken form: the form is about the
  // credentials, and the row that draws this says it could not be read.
  const signingKey = await signingKeyState(params.stage, ctx).catch(() => null);

  return NextResponse.json({ settings, signingKey });
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
    const ctx = settingsContext();
    const { settings, write } = await saveSettings(params.stage, body, ctx);
    const signingKey = await signingKeyState(params.stage, ctx).catch(() => null);
    return NextResponse.json({ settings, write, signingKey });
  } catch (error) {
    // A validation problem is the user's to fix and reads as a sentence; a CLI
    // failure is ours and arrives with the CLI's own last lines.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
