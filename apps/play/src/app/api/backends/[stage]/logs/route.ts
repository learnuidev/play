import { NextResponse } from "next/server";

import { backendContext } from "@/server/backend";
import { backendFunctions, recentLogs } from "@/server/logs";

/**
 * A backend environment's logs.
 *
 * With no `?function=`, the list of functions to choose from — which is the
 * stage's Lambdas, event-driven ones first. With one, the last hour of that
 * function's CloudWatch events.
 *
 * One function at a time on purpose: `FilterLogEvents` takes a single log group,
 * and a new environment has 158 of them, so fanning out per request would be 158
 * API calls to draw a screen.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { stage: string } }) {
  const url = new URL(request.url);
  const wanted = url.searchParams.get("function");
  const minutes = Number(url.searchParams.get("minutes") ?? 60);
  const pattern = url.searchParams.get("q") ?? undefined;

  const ctx = backendContext();

  try {
    const functions = await backendFunctions(params.stage, ctx);

    if (!wanted) {
      return NextResponse.json({ functions, logs: null });
    }

    const fn = functions.find((candidate) => candidate.name === wanted || candidate.key === wanted);
    if (!fn) {
      return NextResponse.json(
        { error: `No function '${wanted}' in ${params.stage}.` },
        { status: 404 },
      );
    }

    const logs = await recentLogs(params.stage, fn, { minutes, pattern }, ctx);
    return NextResponse.json({ functions, logs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
