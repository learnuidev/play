import { NextResponse } from "next/server";

import type { RunSummary } from "@/lib/types";
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
 *
 * ## Why this is a summary
 *
 * A `RunView` is mostly the paragraphs explaining each step, which is the point
 * of the deploy page and dead weight here: this is read every three seconds while
 * anything is deploying, to draw a chip and a step number. Four environments
 * deploying would otherwise be thirty kilobytes a poll.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const runs: RunSummary[] = activeRuns("backend").map((run) => ({
    id: run.id,
    stage: run.stage,
    action: run.action,
    status: run.status,
    startedAt: run.startedAt,
    steps: run.steps.map((step) => ({ id: step.id, title: step.title, status: step.status })),
  }));

  return NextResponse.json({ runs });
}
