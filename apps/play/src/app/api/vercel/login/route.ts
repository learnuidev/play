import { NextResponse } from "next/server";

import { cancelVercelLogin, startVercelLogin } from "@/server/vercel-cli";

/**
 * Starting and stopping the Vercel sign-in.
 *
 * `POST` installs the CLI if it is missing and runs `vercel login`; `DELETE`
 * ends a flow that is waiting for a browser that is not coming. The run itself
 * lives in `server/vercel-cli.ts` and its output on `/api/vercel/login/events` —
 * this route only decides when it begins and ends, which is why `POST` on a
 * running sign-in is not an error: it answers with the run already going rather
 * than starting a second device code nobody is looking at.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({ login: startVercelLogin() }, { status: 201 });
}

export async function DELETE() {
  return NextResponse.json({ login: cancelVercelLogin() });
}
