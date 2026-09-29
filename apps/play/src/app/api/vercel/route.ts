import { NextResponse } from "next/server";

import { saveVercelToken, vercelOverview } from "@/server/vercel";

/**
 * The Vercel integration — read, and the one write that is not to Vercel.
 *
 * `GET` reads projects, deployments and the `NEXT_PUBLIC_*` each project was
 * built with. `PUT` stores or clears the **token**, which is a write to this
 * machine rather than to Vercel: the console never creates a project, changes a
 * variable, or triggers a deployment. `docs/deploy.md` is still how a deploy
 * happens.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ vercel: await vercelOverview() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  let token: string | null = null;
  try {
    const body = (await request.json()) as { token?: string | null };
    token = body.token?.trim() || null;
  } catch {
    return NextResponse.json({ error: "The request body was not JSON." }, { status: 400 });
  }

  saveVercelToken(token);
  return NextResponse.json({ vercel: await vercelOverview() });
}
