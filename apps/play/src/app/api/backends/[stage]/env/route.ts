import { NextResponse } from "next/server";

import { backendContext, backendEnv } from "@/server/backend";

/** A backend environment's inputs and outputs. */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { stage: string } }) {
  try {
    const env = await backendEnv(params.stage, backendContext());
    return NextResponse.json({ env });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
