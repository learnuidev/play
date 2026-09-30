import { NextResponse } from "next/server";

import { activeRuns } from "@/server/run";

/**
 * Every backend deploy going right now — `/api/deploy/runs`.
 *
 * The deploy page asks about **one** environment, because that is what it is
 * about. The list of environments is about all of them at once, so a row that is
 * deploying has to learn it from somewhere else: this.
 *
 * It is deliberately not part of `/api/state`. That route is cached, and the
 * cache is right for what it holds — stack statuses that cost two `aws` processes
 * to read. A run's progress is the opposite: it is free to read, and it is stale
 * within seconds of being written.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ runs: activeRuns("backend") });
}
