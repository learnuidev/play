import { NextResponse } from "next/server";

import { backendContext, deploymentHistory } from "@/server/backend";

/**
 * What has been deployed to this environment, from CloudFormation.
 *
 * Not from the console's own memory: that keeps one run for as long as the
 * process lives, so a history built on it would begin when the page was opened.
 * CloudFormation holds every create, update and rollback with the reason, and it
 * outlives all of this.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { stage: string } }) {
  try {
    const history = await deploymentHistory(params.stage, backendContext());
    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
