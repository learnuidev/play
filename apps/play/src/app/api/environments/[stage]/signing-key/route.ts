import { NextResponse } from "next/server";

import { ensureSigningKey, signingKeyState } from "@/server/signing-key";
import { settingsContext } from "@/server/settings";

/**
 * The CloudFront signing key: what is there, and putting it there.
 *
 * `GET` is the read the Checklist tab draws its row from — two parameter names
 * in one call, with no decryption, so no part of the private key crosses into
 * this process. `POST` is the button: it runs
 * `infra/scripts/ensure-cloudfront-key.mjs`, which writes whichever half is
 * missing and **leaves an existing pair alone**.

 * The key pair is product configuration rather than per-environment state — on
 * every stage here the two parameter names are the same shared ones — so this is
 * usually a check mark with nothing behind it. The way to see that, rather than
 * guess, is the response's `note`, which is the script's own answer in one line
 * ("both halves were already in SSM — nothing was written").
 */

export const dynamic = "force-dynamic";

type Params = { params: { stage: string } };

export async function GET(_request: Request, { params }: Params) {
  try {
    const signingKey = await signingKeyState(params.stage, settingsContext());
    return NextResponse.json({ signingKey });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const { key, note } = await ensureSigningKey(params.stage, settingsContext());
    return NextResponse.json({ signingKey: key, note });
  } catch (error) {
    // The script's refusals are sentences meant for a person — a distribution
    // that was built against a public key the pair has to match, or an AWS
    // error with the CLI's own last lines — so they are returned as they are.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
