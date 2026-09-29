"use client";

import { KeyRoundIcon } from "lucide-react";

import type { EnvRow } from "@/lib/types";
import { Chip } from "@/components/ui/chip";

/**
 * A list of values, and — the column that matters — where each one came from.
 *
 * The same table serves a backend's inputs, its outputs, and a frontend's
 * variables, because in all three cases the question being asked is identical:
 * *what is this, and who put it there?* A value with no provenance is a value
 * nobody can trust or change, which is most of the reason this console exists.
 *
 * A secret is never rendered: the row says whether one is stored. A value that
 * is missing says so rather than rendering an empty cell, because an absent API
 * URL and an empty one are different problems.
 */
export function EnvTable({
  rows,
  emptyNote,
}: {
  rows: EnvRow[];
  emptyNote?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">{emptyNote ?? "Nothing to show yet."}</p>
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <EnvTableRow key={row.key} row={row} />
      ))}
    </div>
  );
}

function EnvTableRow({ row }: { row: EnvRow }) {
  return (
    <div className="border-border/40 flex flex-col gap-1.5 border-t py-3.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 sm:w-64 sm:shrink-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs font-medium" title={row.key}>
            {row.key}
          </span>
          {row.secret ? (
            <KeyRoundIcon className="text-muted-foreground size-3 shrink-0" aria-hidden />
          ) : null}
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{row.source}</p>
      </div>

      <div className="min-w-0 flex-1">
        {row.secret ? (
          <span className="text-muted-foreground text-xs">
            {row.value ?? "not stored — set it in the form above"}
          </span>
        ) : row.value ? (
          <code className="block truncate font-mono text-xs" title={row.value}>
            {row.value}
          </code>
        ) : (
          <span className="text-muted-foreground text-xs">— not set</span>
        )}

        {row.usedBy && row.usedBy.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {row.usedBy.map((who) => (
              <Chip key={who} tone="muted">
                {who}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      {row.editable ? (
        <Chip tone="muted" className="shrink-0">
          editable below
        </Chip>
      ) : null}
    </div>
  );
}
