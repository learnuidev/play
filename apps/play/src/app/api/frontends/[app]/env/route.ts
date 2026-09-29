import { NextResponse } from "next/server";

import type { AppKey } from "@/lib/types";
import { frontendEnv } from "@/server/frontends";
import { settingsContext } from "@/server/settings";

/** What one frontend is handed for one environment. */
export const dynamic = "force-dynamic";

const APPS = new Set(["studio", "marketplace", "demo"]);

export async function GET(request: Request, { params }: { params: { app: string } }) {
  if (!APPS.has(params.app)) {
    return NextResponse.json({ error: `Unknown app '${params.app}'.` }, { status: 404 });
  }

  const stage = new URL(request.url).searchParams.get("stage") ?? "dev";

  try {
    const env = await frontendEnv(params.app as AppKey, stage, settingsContext());
    return NextResponse.json({ env });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
