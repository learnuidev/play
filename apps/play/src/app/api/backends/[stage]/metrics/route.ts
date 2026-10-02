import { NextResponse } from "next/server";

import { rangeFor } from "@/lib/ranges";
import { backendContext } from "@/server/backend";
import { backendFunctions } from "@/server/logs";
import { functionMetrics } from "@/server/metrics";

/**
 * What one function has been doing, as CloudWatch measures it.
 *
 * The window is `?minutes=`, and it is one of the ranges the page offers —
 * anything else falls back to the default rather than erroring, because the
 * period has to be one CloudWatch accepts and a made-up window is a chart
 * nobody asked for. Which function is `?function=`, by key or by deployed name,
 * resolved against the stage's own function list so that a name from another
 * environment is a 404 rather than three empty metric queries.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { stage: string } }) {
  const url = new URL(request.url);
  const wanted = url.searchParams.get("function");
  const minutes = Number(url.searchParams.get("minutes") ?? "");

  if (!wanted) {
    return NextResponse.json({ error: "Name a function." }, { status: 400 });
  }

  const ctx = backendContext();

  try {
    const functions = await backendFunctions(params.stage, ctx);
    const fn = functions.find(
      (candidate) => candidate.name === wanted || candidate.key === wanted,
    );
    if (!fn) {
      return NextResponse.json(
        { error: `No function '${wanted}' in ${params.stage}.` },
        { status: 404 },
      );
    }

    const metrics = await functionMetrics(
      params.stage,
      fn.name,
      rangeFor(Number.isFinite(minutes) && minutes > 0 ? minutes : 0),
      ctx,
    );
    return NextResponse.json({ metrics });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
