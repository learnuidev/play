import { NextResponse } from "next/server";

import type { ConsoleState, EnvironmentView } from "@/lib/types";
import { getIdentity, identityError, snapshotPlayStacks } from "@/server/aws";
import { consoleDefaults, environmentView, listStages } from "@/server/environments";
import { repoRoot } from "@/server/repo";

/**
 * Everything the console's chrome draws: who we are, and what exists.
 *
 * Read-only, and it stays that way. Every call this makes is a `describe` or a
 * `list`, so opening the console — or leaving it open on a second monitor —
 * costs nothing and can never change anything. The one write in this app is the
 * deploy, and it is behind a button.
 *
 * ## Why there is a cache
 *
 * The two calls behind this are `aws` processes, and an `aws` process is about a
 * second of Node starting up before it says anything. The page reads this on
 * mount, on every window focus and every thirty seconds, and a rail that takes
 * two and a half seconds to redraw is a rail nobody trusts. Five seconds is
 * short enough that a deploy's stack statuses are still current by the time
 * anybody looks, and long enough that a page navigation is instant.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MS = 5_000;

interface Cache {
  at: number;
  state: ConsoleState;
}

declare global {
  // eslint-disable-next-line no-var
  var __playConsoleStateCache: Cache | undefined;
}

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.has("fresh");
  const cached = globalThis.__playConsoleStateCache;

  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.state);
  }

  const { profile, profileSource, region } = consoleDefaults();

  // Together, not one after the other: they are two `aws` processes with nothing
  // to say to each other, and running them in sequence is a second of the two
  // and a half spent waiting for a process to start.
  const [identity, stacks] = await Promise.all([
    getIdentity({ profile, region }),
    snapshotPlayStacks({ profile, region }),
  ]);

  // The identity read is allowed to fail — an expired SSO session is the most
  // likely thing anybody sees when they open this page — so the reason is
  // carried rather than thrown, and the chrome says it in a sentence instead of
  // rendering an error page.
  const identityFailure = identity ? null : await identityError({ profile, region });

  const environments: EnvironmentView[] = listStages().map((stage) =>
    environmentView(stage, stacks, { profile, region }),
  );

  // A stage is only interesting if it is deployable, deployed, or named dev. A
  // stray config file for a stage somebody abandoned is noise on a control
  // panel, and a stage named only in this session is not in the repository at
  // all — the rail adds that one itself.
  const known = environments.filter(
    (environment) =>
      environment.stage === "dev" ||
      environment.hasConfig ||
      environment.stacks.some((stack) => stack.status !== "NOT_DEPLOYED"),
  );

  const state: ConsoleState = {
    repoRoot: repoRoot(),
    profile,
    profileSource,
    region,
    identity,
    identityError: identityFailure,
    environments: known,
    suggestions: [],
  };

  globalThis.__playConsoleStateCache = { at: Date.now(), state };
  return NextResponse.json(state);
}
