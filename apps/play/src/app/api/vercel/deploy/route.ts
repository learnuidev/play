import { NextResponse } from "next/server";

import type { VercelDeployTarget, VercelTarget } from "@/lib/types";
import { cancelRun, currentRun, isRunning, startRun } from "@/server/run";
import { vercelDeployPreview, vercelRunSpec } from "@/server/vercel-plan";
import { APPS, appDefinition } from "@/server/repo";

/**
 * Deploying a frontend to Vercel.
 *
 * `GET` answers with the run if there is one — so a page reloaded mid-build
 * draws it — and with the run's own checklist when there is not. `POST` starts
 * one, and `DELETE` stops it.
 *
 * This is the console's **one write to Vercel**, and it is a run rather than a
 * button that fires six API calls, because a frontend deployment is not the API
 * calls: it is that `NEXT_PUBLIC_*` is inlined at build time, so the variables
 * mean nothing until the app is rebuilt and the rebuild is the thing worth
 * watching. `server/vercel-plan.ts` is the plan, step by step.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND = "frontend" as const;

const TARGETS: VercelTarget[] = ["production", "preview", "development"];

/**
 * The four things a deploy is described by, checked rather than trusted.
 *
 * Each one ends up somewhere different and none of them can be derived from the
 * others: the app picks the Vercel project, the stage picks which backend's
 * outputs become the values, the target picks which of Vercel's three sets they
 * are written to, and the domain is a name that has to be *somebody's*.
 */
function parseTarget(body: unknown): VercelDeployTarget | string {
  if (typeof body !== "object" || body === null) {
    return "Expected a JSON body of the shape { app, stage, target, domain? }.";
  }
  const input = body as Record<string, unknown>;

  const app = typeof input.app === "string" ? input.app : "";
  if (app === "demo") {
    return "The demo is not deployed anywhere. It is a third-party OAuth client of the API rather than a product surface — studio and marketplace are the two this console ships to Vercel.";
  }
  if (!APPS.some((candidate) => candidate.key === app)) {
    return `'${app}' is not a frontend this console deploys. It is studio or marketplace.`;
  }

  const stage = typeof input.stage === "string" ? input.stage.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(stage)) {
    return `'${stage}' is not a stage name. Use lower-case letters, digits and dashes — it becomes a stack-name suffix and a config filename.`;
  }

  const target = typeof input.target === "string" ? input.target : "";
  if (!TARGETS.includes(target as VercelTarget)) {
    return `'${target}' is not a Vercel target. It is one of ${TARGETS.join(", ")} — where in Vercel the values are written, which is not the same question as which backend they point at.`;
  }

  const raw = typeof input.domain === "string" ? input.domain.trim() : "";
  const domain = raw ? normaliseDomain(raw) : null;
  if (raw && !domain) {
    return `'${raw}' is not a hostname. Give a bare domain — staging.studio.lets-play.xyz — rather than a URL.`;
  }

  return { app: appDefinition(app)!.key, stage, target: target as VercelTarget, domain };
}

/**
 * A hostname, however it was typed.
 *
 * `https://` and a trailing slash are what a browser bar gives you, and Vercel's
 * domains API takes neither — it would refuse with a sentence about an invalid
 * domain name. `www.` is deliberately *not* stripped: it is a different name and
 * somebody may well mean it.
 */
function normaliseDomain(value: string): string | null {
  const stripped = value
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(stripped)
    ? stripped
    : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Which question this is depends on how much of the target is named. The app
  // alone asks about **the run** — what this project is doing, or last did — so a
  // page reloaded mid-build draws it; a stage and a target together are a
  // complete deploy, and answer with its checklist.
  const app = url.searchParams.get("app");
  if (!app || !url.searchParams.get("stage")) {
    if (!app || !APPS.some((candidate) => candidate.key === app)) {
      return NextResponse.json(
        {
          error:
            "Expected ?app=<studio|marketplace> — a frontend run belongs to one app. Add stage and target for the deploy's checklist.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ run: currentRun(KIND, app), running: isRunning(KIND, app) });
  }

  const target = parseTarget({
    app,
    stage: url.searchParams.get("stage"),
    target: url.searchParams.get("target"),
    domain: url.searchParams.get("domain"),
  });
  if (typeof target === "string") {
    return NextResponse.json({ error: target }, { status: 400 });
  }

  try {
    return NextResponse.json({ preview: await vercelDeployPreview(target) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const target = parseTarget(body);
  if (typeof target === "string") {
    return NextResponse.json({ error: target }, { status: 400 });
  }

  try {
    return NextResponse.json({ run: startRun(vercelRunSpec(target)) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const app = new URL(request.url).searchParams.get("app")?.trim() ?? "";
  if (!app) {
    return NextResponse.json(
      { error: "Expected ?app=<studio|marketplace> — a frontend run belongs to one app." },
      { status: 400 },
    );
  }

  const run = currentRun(KIND, app);
  if (!run || !isRunning(KIND, app)) {
    return NextResponse.json({ error: `Nothing is running for '${app}'.` }, { status: 409 });
  }
  cancelRun(KIND, app, run.id);
  return NextResponse.json({ ok: true });
}
