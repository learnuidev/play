import { NextResponse } from "next/server";

import { listServices, occupiedPorts } from "@/server/services";

/**
 * The three frontends, as the cards draw them.
 *
 * `occupied` is the one piece of extra information: a port something else is
 * already listening on is the failure a start would otherwise report as four
 * lines of Node stack trace from inside a spawned process.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const services = listServices();
  const running = new Set(
    services.filter((service) => service.status !== "stopped").map((service) => service.port),
  );
  const occupied = (await occupiedPorts()).filter((port) => !running.has(port));

  return NextResponse.json({ services, occupied });
}
