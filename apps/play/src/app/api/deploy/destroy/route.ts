import { NextResponse } from "next/server";

import { startDestroy } from "@/server/run";
import { destroyFromBody } from "@/server/run-api";
import { consoleDefaults } from "@/server/environments";

/**
 * Deleting an environment — `POST /api/deploy/destroy`.
 *
 * Its own route rather than a verb on `/api/deploy`, because `DELETE /api/deploy`
 * already means something else: *stop the run that is going*. Two operations on
 * one path where one of them is "cancel" and the other is "delete everything"
 * would be a route nobody could read.
 *
 * Nothing else is needed here. The run it starts is read, streamed and cancelled
 * through `/api/deploy` like any other backend run — same store, same key, so a
 * delete and a deploy of one stage cannot overlap — and what makes it a delete is
 * the step list `buildDestroyPlan` hands the engine.
 *
 * The body carries the stage and one choice: `deleteData`, which decides whether
 * the plan includes the five steps that delete the tables, the media, the pool,
 * the log groups and this stage's secrets. It is the same choice the tick on the
 * page makes, and the default here is the safe one — a body that does not mention
 * it deletes the stacks and the config file and leaves the data where it is.
 *
 * **The typed confirmation is not on this route.** The page asks for the stage
 * name before it sends this request, which is where a confirmation belongs: a
 * request that carried its own "yes, really" would be a request any script could
 * send. What this refuses is the one case the console can decide — an environment
 * that is already deploying, or already being deleted.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await destroyFromBody(request);
  if (parsed instanceof NextResponse) return parsed;

  const { profile, region } = consoleDefaults();

  try {
    const run = startDestroy({
      stage: parsed.stage,
      profile,
      region,
      deleteData: parsed.deleteData,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}
