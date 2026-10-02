import { NextResponse } from "next/server";

import { backendContext } from "@/server/backend";
import { backendTables, describeTable, readTableItems } from "@/server/tables";

/**
 * A backend environment's tables.
 *
 * With no `?table=`, the list of them — which is one `ListTables` call, because
 * a row count is one `DescribeTable` per table and an environment has
 * twenty-nine of them.
 *
 * With one, everything about that table: its shape, and a page of its rows. The
 * form's four fields — `attribute`, `operator`, `value`, `type` — are what make
 * the difference between reading the table in its own order and asking it a
 * question, and `token` is the CLI's own cursor, handed back for the next page.
 *
 * **Every call this route makes is a read.** `DescribeTable`, `Query`, `Scan` —
 * there is no path through here that writes a row, which is the console's own
 * rule about AWS and the reason this tab has no save button anywhere on it.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { stage: string } }) {
  const url = new URL(request.url);
  const wanted = url.searchParams.get("table");
  const ctx = backendContext();

  try {
    const list = await backendTables(params.stage, ctx);

    if (!wanted) {
      return NextResponse.json(list);
    }

    const known = list.tables.find(
      (candidate) => candidate.name === wanted || candidate.key === wanted,
    );
    if (!known) {
      return NextResponse.json(
        { error: `No table '${wanted}' in ${params.stage}.` },
        { status: 404 },
      );
    }

    const shape = await describeTable(params.stage, known.name, ctx);

    // No attribute and no value means "show me the table as it is", so the page
    // is read without any question being asked of it — which is what opening a
    // table should do.
    const items = await readTableItems(
      shape,
      {
        attribute: url.searchParams.get("attribute") ?? undefined,
        operator: url.searchParams.get("operator") ?? undefined,
        value: url.searchParams.get("value") ?? undefined,
        type: url.searchParams.get("type") ?? undefined,
        token: url.searchParams.get("token") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? "") || undefined,
      },
      ctx,
    );

    return NextResponse.json({ ...list, table: shape.detail, items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
