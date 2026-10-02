"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  CheckIcon,
  CopyIcon,
  DatabaseIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";

import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, TextInput } from "@/components/ui/field";
import { Picker } from "@/components/ui/picker";
import { Tabs, useTabParam } from "@/components/ui/tabs";
import { dynamoColumns, dynamoKeyLine, renderDynamoValue } from "@/lib/dynamo";
import { bytes, plural, relative } from "@/lib/format";
import type {
  DynamoRow,
  TableDetailView,
  TableItemsView,
  TableKeyView,
  TableSummaryList,
} from "@/lib/types";

/**
 * The tables this environment reads, and a window onto their rows.
 *
 * ## What this tab is for
 *
 * The other four tabs describe the *deployment* — what it needs, what it
 * published, what CloudFormation did, what it logged. This one reads the
 * product: whether the webhook actually wrote the payment, whether the
 * membership row is there, whether a profile picked up the name somebody typed.
 * Those are the questions that otherwise end in a terminal and a shell history
 * nobody else can read, which is the console's whole reason for existing.
 *
 * ## Three views, because the three questions are asked separately
 *
 * *Which table am I looking at* is the picker at the top and stays put. Under it
 * are the three things somebody actually comes here to do, and they are one at a
 * time rather than one long column: **data** is the rows, **info** is what the
 * table *is* — its keys, its indexes and DynamoDB's own counts — and **query** is
 * the form that aims the read. Stacked, they were a card of schema facts above a
 * form above a wall of rows, and the rows are the reason anybody opens this.
 *
 * Which one is showing is `?view=`, the same parameter mechanism the page's own
 * tabs use: `?tab=tables&view=query` is a link somebody can be sent.
 *
 * ## The two reads, and why the page says which one it made
 *
 * A **query** needs a partition key, and this tab knows which attributes those
 * are because `DescribeTable` says so — so asking about a key is one round trip
 * that reads what it returns. Anything else is a **scan with a filter**, which
 * reads the table and throws away what does not match. The two are not
 * interchangeable in cost, and the difference is invisible in the shape of an
 * answer, so the read is written out above the rows and the counts say what it
 * actually read.
 *
 * ## Nothing here writes
 *
 * Every call behind this tab is a `DescribeTable`, a `Query` or a `Scan`. There
 * is no edit field and no delete button, deliberately: a control room that can
 * change the product's rows is a control room where a slip is data loss with no
 * undo, and the console's rule about AWS — reads only, writes behind the plan's
 * own buttons — is what keeps "the console cannot break an environment" true.
 */

/**
 * The two things this tab shows: the rows, and what the table *is*.
 *
 * **Two, not three.** Aiming a read is not a place to be — it is a thing you do
 * to the rows in front of you, so it is a button on the Data view that opens the
 * form over the table, and pressing it again puts the form away. A third tab
 * would have made "where am I" and "what am I doing" the same question, and
 * running a query would have moved you somewhere to show you the answer.
 */
const TABLE_VIEWS = [
  {
    id: "data",
    label: "Data",
    hint: "The table's rows. Nothing is ordered — DynamoDB has no order of its own — so this is whatever the storage holds.",
  },
  {
    id: "info",
    label: "Info",
    hint: "What the table is. The row count and the size are DynamoDB's own, which it refreshes about every six hours; a live count means reading every row.",
  },
] as const;

/** What a page asks for, and what it re-asks for when the filter changes. */
interface AppliedQuery {
  attribute: string;
  operator: string;
  value: string;
  type: string;
}

const NO_QUERY: AppliedQuery = { attribute: "", operator: "=", value: "", type: "auto" };

const OPERATORS = [
  { value: "=", label: "equals" },
  { value: "begins_with", label: "begins with" },
  { value: "contains", label: "contains" },
  { value: ">", label: "greater than" },
  { value: "<", label: "less than" },
];

const TYPES = [
  { value: "auto", label: "auto", hint: "the key schema decides" },
  { value: "S", label: "string" },
  { value: "N", label: "number" },
  { value: "BOOL", label: "boolean" },
];

export function TablesView({ stage }: { stage: string }) {
  // The page's own `?tab=` is the tab strip above this; the sub-strip's is
  // `?view=`, so both can be in one URL — `?tab=tables&view=query`.
  const { tab: view, select } = useTabParam(TABLE_VIEWS, "view");

  const [list, setList] = useState<TableSummaryList | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<TableDetailView | null>(null);
  const [items, setItems] = useState<TableItemsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** The form, and the query the rows below the strip are actually from. */
  const [form, setForm] = useState<AppliedQuery>(NO_QUERY);
  const [applied, setApplied] = useState<AppliedQuery>(NO_QUERY);

  /** Reads a table, and answers whether it worked — the form switches views on it. */
  const read = useCallback(
    async (table: string, query: AppliedQuery, token?: string, append = false) => {
      if (!table) return false;
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ table });
      if (query.attribute.trim()) {
        params.set("attribute", query.attribute.trim());
        params.set("operator", query.operator);
        params.set("value", query.value);
        // `auto` is not sent: the absence of a type is what tells the server to
        // read it off the table's own key schema.
        if (query.type !== "auto") params.set("type", query.type);
      }
      if (token) params.set("token", token);

      try {
        const response = await fetch(
          `/api/backends/${encodeURIComponent(stage)}/tables?${params.toString()}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as {
          table?: TableDetailView;
          items?: TableItemsView;
          error?: string;
        };
        if (!response.ok || !body.table || !body.items) {
          setError(body.error ?? "The table could not be read.");
          return false;
        }

        const page = body.items;
        setDetail(body.table);
        setItems((previous) =>
          append && previous ? { ...page, rows: [...previous.rows, ...page.rows] } : page,
        );
        setApplied(query);
        return true;
      } catch {
        setError("The table could not be read.");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [stage],
  );

  // The list of tables first, then the first of them — a page that opened with a
  // picker and nothing under it would make every visit start with a choice that
  // has one obvious answer.
  useEffect(() => {
    let cancelled = false;
    setList(null);
    setSelected("");
    setDetail(null);
    setItems(null);
    setError(null);
    setForm(NO_QUERY);
    setApplied(NO_QUERY);

    fetch(`/api/backends/${encodeURIComponent(stage)}/tables`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as TableSummaryList & { error?: string };
        if (cancelled) return;
        setList({ tables: body.tables ?? [], note: body.note ?? null });
        if (body.tables?.length) {
          setSelected(body.tables[0].name);
          void read(body.tables[0].name, NO_QUERY);
        }
      })
      .catch(() => {
        if (!cancelled) setError("The tables could not be listed.");
      });

    return () => {
      cancelled = true;
    };
  }, [stage, read]);

  const chosen = list?.tables.find((table) => table.name === selected) ?? null;
  /** A read somebody aimed, rather than the table in its own order. */
  const aimed = applied.attribute.trim().length > 0;

  /**
   * Whether the query form is open over the rows.
   *
   * Held here rather than inside the Data view so that stepping over to Info to
   * read a key's type and back does not put the form away — the question "what
   * am I doing" should outlive "where am I looking", and only one of the two is
   * a place.
   */
  const [queryOpen, setQueryOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeading
          title="Tables"
          hint="Everything this environment reads: the tables it imports by name, and the ones its own data stack created. A table's rows and size are read with the table itself — one call each — so this list is only names."
        />

        <div className="mt-5 flex flex-wrap items-end gap-4">
          <Picker
            className="min-w-64 flex-1"
            label="Table"
            value={selected}
            onChange={(next) => {
              setSelected(next);
              setForm(NO_QUERY);
              void read(next, NO_QUERY);
            }}
            options={
              list?.tables.length
                ? list.tables.map((table) => ({
                    value: table.name,
                    label: table.key,
                    hint: table.imported ? "imported" : "created here",
                  }))
                : [{ value: "", label: "no tables" }]
            }
          />

          <Button
            variant="ghost"
            onClick={() => selected && void read(selected, applied)}
            busy={loading}
            icon={<RefreshCwIcon className="size-3.5" />}
          >
            refresh
          </Button>
        </div>

        {chosen ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground font-mono">{chosen.name}</span>
            <Chip tone={chosen.imported ? "warn" : "muted"}>
              {chosen.imported ? "imported — shared, unmanaged by a deploy" : "created here"}
            </Chip>
          </div>
        ) : null}

        {list?.note ? <p className="text-muted-foreground mt-4 text-xs">{list.note}</p> : null}
      </Card>

      <Tabs tabs={TABLE_VIEWS} value={view} onChange={select} />

      {view === "info" ? (
        <InfoView detail={detail} chosen={chosen !== null} error={error} />
      ) : null}

      {view === "data" ? (
        <DataView
          items={items}
          keys={detail?.keys ?? []}
          aimed={aimed}
          loading={loading}
          error={error}
          queryOpen={queryOpen}
          onToggleQuery={() => setQueryOpen((open) => !open)}
          query={{
            detail,
            form,
            setForm,
            run: () => read(selected, form),
            clear: () => {
              setForm(NO_QUERY);
              void read(selected, NO_QUERY);
            },
          }}
          onMore={() => void read(selected, applied, items?.token ?? undefined, true)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Info — what the table is
 * ------------------------------------------------------------------ */

function InfoView({
  detail,
  chosen,
  error,
}: {
  detail: TableDetailView | null;
  chosen: boolean;
  error: string | null;
}) {
  if (!detail) {
    return (
      <Card>
        {error ? (
          <p className="text-destructive font-mono text-xs whitespace-pre-wrap">{error}</p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {chosen ? "Reading the table…" : "No table to show — this environment has none."}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Status">
          <Chip tone={detail.status === "ACTIVE" ? "ok" : "warn"}>{detail.status}</Chip>
        </Fact>
        <Fact label="Rows">{plural(detail.itemCount, "row")}</Fact>
        <Fact label="Size">{bytes(detail.sizeBytes)}</Fact>
        <Fact label="Billing">{detail.billingMode ?? "—"}</Fact>
        <Fact label="Created">{detail.created ? relative(detail.created, Date.now()) : "—"}</Fact>
        <Fact label="Key">
          <span className="font-mono">
            {detail.keys
              .map((key) => `${key.name} (${key.kind === "HASH" ? "partition" : "sort"}, ${key.type})`)
              .join(" + ") || "—"}
          </span>
        </Fact>
      </div>

      {detail.indexes.length ? (
        <div className="mt-6 flex flex-col">
          {detail.indexes.map((index) => (
            <div
              key={index.name}
              className="border-border/40 flex flex-wrap items-baseline gap-x-3 border-t py-2.5 text-xs first:border-t-0"
            >
              <span className="font-mono">{index.name}</span>
              <span className="text-muted-foreground font-mono">
                {index.keys.map((key) => `${key.name} (${key.type})`).join(", ")}
              </span>
              <span className="text-muted-foreground ml-auto">{index.projection}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground mt-6 text-xs">No indexes.</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Query — the form that aims a read
 * ------------------------------------------------------------------ */

/** What the form needs, bundled: the Data view renders it and owns its toggling. */
interface QueryControl {
  detail: TableDetailView | null;
  form: AppliedQuery;
  setForm: (query: AppliedQuery) => void;
  /** Runs the read. The answer is drawn by the rows below it, not returned here. */
  run: () => Promise<boolean>;
  clear: () => void;
}

/**
 * The form, when it is open.
 *
 * It opens *over the table* rather than in a place of its own, and the button
 * that opens it closes it again: a query is something done to the rows in front
 * of you, so the rows stay where they are and the form arrives above them. That
 * is also why nothing here switches view on success — the answer appears directly
 * under the form that asked for it.
 */
function QueryForm({
  detail,
  form,
  setForm,
  loading,
  run,
  clear,
}: QueryControl & { loading: boolean }) {
  return (
    <div className="border-border/40 border-b px-6 pb-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <Field
          label="Attribute"
          htmlFor="table-attribute"
          hint="A key is one round trip; anything else reads every row."
        >
          <TextInput
            id="table-attribute"
            value={form.attribute}
            onChange={(event) => setForm({ ...form, attribute: event.target.value })}
            placeholder="userId"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Picker
          label="Operator"
          value={form.operator}
          onChange={(next) => setForm({ ...form, operator: next })}
          options={OPERATORS}
        />

        <Field label="Value" htmlFor="table-value">
          <TextInput
            id="table-value"
            value={form.value}
            onChange={(event) => setForm({ ...form, value: event.target.value })}
            placeholder="8d3e97eb-…"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Picker
          label="As"
          value={form.type}
          onChange={(next) => setForm({ ...form, type: next })}
          options={TYPES}
        />

        <div className="flex items-center gap-2">
          {/* "read" rather than "query" or "scan": which of the two it turns out
              to be is decided by whether the attribute named is a key, and a
              button that promised one and made the other would be this tab
              lying about what it cost. The result says which one happened. */}
          <Button
            type="submit"
            variant="primary"
            busy={loading}
            icon={<SearchIcon className="size-3.5" />}
          >
            read
          </Button>
          {form.attribute || form.value ? (
            <Button variant="ghost" onClick={clear}>
              clear
            </Button>
          ) : null}
        </div>
      </form>

      {/* The keys a query can be answered from, as buttons rather than as a
          sentence: this is the difference between one round trip and a full
          table read, and nobody should have to read a schema to take it. Each
          fills the attribute; the table's own key type decides the comparison. */}
      {detail?.targets.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Keys:</span>
          {detail.targets.map((target) => {
            const attribute = target.split(" via ")[0];
            return (
              <button
                key={target}
                type="button"
                onClick={() => setForm({ ...form, attribute, type: "auto" })}
                className="border-border/70 bg-muted/40 hover:bg-accent text-muted-foreground hover:text-foreground rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors"
              >
                {target}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Data — the rows
 * ------------------------------------------------------------------ */

/**
 * A page of rows, as a table or as JSON — with the query form over it when the
 * button is on.
 *
 * **A table**, because that is what a row of DynamoDB attributes is: the columns
 * are the attribute names the page happens to hold, and a table is the only
 * shape in which "which of these users has a photo" is answerable by looking.
 * DynamoDB is schemaless, so the columns are *derived from the rows* rather than
 * asked of the table — key attributes first, then the rest alphabetically.
 *
 * **JSON**, because a value can be nested deeper than a cell: a profile's
 * socials, a quiz's questions, a transcript's words. It is the CLI's own output,
 * `{ S: … }` wrappers and all, which is the form that can be pasted back into
 * `put-item` — and the reason it is not prettified into something that looks
 * like the table but is not.
 *
 * Both are drawn from the same read: the items the server sent, untouched.
 */
function DataView({
  items,
  keys,
  aimed,
  loading,
  error,
  queryOpen,
  onToggleQuery,
  query,
  onMore,
}: {
  items: TableItemsView | null;
  /** The table's own key attributes, so the identity column comes first. */
  keys: TableKeyView[];
  aimed: boolean;
  loading: boolean;
  error: string | null;
  queryOpen: boolean;
  onToggleQuery: () => void;
  query: QueryControl;
  onMore: () => void;
}) {
  const [mode, setMode] = useState<"table" | "json">("table");

  return (
    <Card flush className="pb-4">
      <div className="flex flex-wrap items-center gap-3 px-6 pt-6">
        <h2 className="text-base font-semibold tracking-tight">
          {aimed ? "Matching rows" : "Rows"}
        </h2>
        {loading ? <Chip tone="run">reading</Chip> : null}
        {items ? (
          <>
            <Chip tone={items.via === "query" ? "ok" : "muted"}>
              {items.via === "query" ? "query" : "scan"}
            </Chip>
            <span className="text-muted-foreground text-xs">
              {plural(items.scanned, "row")} read · {plural(items.matched, "match")}
              {items.indexName ? ` · via ${items.indexName}` : ""}
            </span>
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          {/* The form's switch. One button that opens and closes it, rather
              than a place to navigate to: what it does is about the rows on
              screen, and the rows stay on screen the whole time. */}
          <Button
            size="sm"
            variant={queryOpen ? "primary" : "secondary"}
            aria-pressed={queryOpen}
            aria-expanded={queryOpen}
            icon={<SearchIcon className="size-3.5" />}
            onClick={onToggleQuery}
          >
            query
          </Button>

          {/* And this is how the same rows are written down — a preference,
              not a place, which is why it is a pair of buttons and not a
              third tab strip. */}
          {items?.rows.length ? (
            <div className="flex items-center gap-1">
              {(["table", "json"] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={mode === option ? "primary" : "ghost"}
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* The form, over the rows — opened and closed by the button above it. */}
      {queryOpen ? <QueryForm {...query} loading={loading} /> : null}

      {error ? (
        <p className="text-destructive mt-4 px-6 font-mono text-xs whitespace-pre-wrap">{error}</p>
      ) : null}

      {items?.expression ? (
        <p className="text-muted-foreground mt-3 px-6 font-mono text-xs">{items.expression}</p>
      ) : null}

      {items?.note ? <p className="text-muted-foreground mt-2 px-6 text-xs">{items.note}</p> : null}

      {!items ? (
        <p className="text-muted-foreground mt-4 px-6 text-xs">Reading the table…</p>
      ) : items.rows.length === 0 ? (
        <p className="text-muted-foreground mt-4 flex items-center gap-2 px-6 text-xs">
          <DatabaseIcon className="size-3.5" />
          {items.note ?? "Nothing to show."}
        </p>
      ) : mode === "table" ? (
        <RowsTable items={items.rows} keys={keys} />
      ) : (
        <RowsJson items={items.rows} />
      )}

      {items?.token ? (
        <div className="mt-4 px-6">
          <Button variant="secondary" size="sm" busy={loading} onClick={onMore}>
            more
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The rows as a grid.
 *
 * TanStack Table over the page that is loaded, and over **the page only**: this
 * is not a server-side paginated table, because DynamoDB has no `ORDER BY` to
 * paginate on and sorting a table you have not read is a promise no client can
 * keep. What the sort does is order the rows in hand, which is what somebody
 * comparing twenty-five of them wants; the cursor at the bottom is how you see
 * more of the table.
 *
 * Every column is an `accessorFn` rather than an `accessorKey`, and not by
 * preference: `accessorKey` reads a dot as a path, and a DynamoDB attribute name
 * may simply contain one — `stripePaymentIntentId` is fine, `socials.website`
 * would have been read as a nested lookup and rendered as nothing.
 */
function RowsTable({ items, keys }: { items: DynamoRow[]; keys: TableKeyView[] }) {
  // Sorting is client state rather than a URL parameter: unlike the tab strip,
  // it is about the rows on screen rather than about which screen you are on,
  // and a link to "sorted by createdAt" is a link to a page of data that the
  // next reader will see anyway.
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<DynamoRow>[]>(
    () =>
      dynamoColumns(items, keys).map((name) => ({
        id: name,
        header: name,
        accessorFn: (row: DynamoRow) => row[name],
        // Compared as rendered, because that is what the two values *are* to
        // whoever is reading the column — except where the rendered text is a
        // number, which sorts numerically rather than as `"9" > "10"`.
        sortingFn: (a, b) => {
          const left = renderDynamoValue(a.getValue(name));
          const right = renderDynamoValue(b.getValue(name));
          if (left.type === "N" && right.type === "N") {
            return Number(left.text) - Number(right.text);
          }
          return left.text.localeCompare(right.text);
        },
        cell: (info) => <Cell value={info.getValue()} />,
      })),
    [items, keys],
  );

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mt-4 overflow-x-auto px-6">
      <table className="w-full border-collapse text-xs">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-border/40 border-y">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className="text-muted-foreground py-2 pr-4 text-left font-medium whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="hover:text-foreground inline-flex items-center gap-1.5 font-mono transition-colors"
                      title={`Sort by ${String(header.column.columnDef.header)}`}
                    >
                      {String(header.column.columnDef.header)}
                      <ArrowUpDownIcon
                        className={sorted ? "text-foreground size-3" : "size-3 opacity-40"}
                      />
                      {sorted ? (
                        <span className="sr-only">
                          {sorted === "asc" ? "sorted ascending" : "sorted descending"}
                        </span>
                      ) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {table.getRowModel().rows.map((row) => (
            // The row's own identity in a tooltip: the key columns are first and
            // often truncated, and a value that runs off the side of a cell is
            // still the value somebody is looking for.
            <tr
              key={row.id}
              title={dynamoKeyLine(row.original, keys)}
              className="border-border/40 hover:bg-muted/30 border-b last:border-b-0"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="py-2 pr-4 align-top font-mono">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One cell.
 *
 * Truncated rather than wrapped, with the whole value in the title: a column
 * whose width is decided by its longest id is a table you scroll sideways
 * forever, and the alternative — wrapping — turns twenty-five rows into a page
 * nobody can read down. The type rides beside the value for everything that is
 * not a string, because `172348` and `"172348"` are the same four pixels and
 * different attributes.
 */
function Cell({ value }: { value: unknown }) {
  const rendered = renderDynamoValue(value);

  if (value === undefined) {
    return <span className="text-muted-foreground/40">—</span>;
  }

  return (
    <span className="flex max-w-96 items-baseline gap-1.5">
      <span className="truncate" title={rendered.text}>
        {rendered.text}
      </span>
      {rendered.type !== "S" ? (
        <span className="text-muted-foreground/70 shrink-0">{rendered.type}</span>
      ) : null}
    </span>
  );
}

/**
 * The rows as JSON: exactly what the CLI printed.
 *
 * The wire format, `{ S: "…" }` and all, rather than the values the table draws.
 * It is the less pretty of the two renderings and the more useful one — it can be
 * pasted into `put-item`, into a bug report or into a shell script without being
 * turned back into DynamoDB's shape by hand first, which is the whole reason to
 * ask for JSON instead of a table.
 */
function RowsJson({ items }: { items: DynamoRow[] }) {
  const json = useMemo(() => JSON.stringify(items, null, 2), [items]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Refused; the text is selectable.
    }
  };

  return (
    <div className="mt-4 px-6">
      <div className="mb-2 flex justify-end">
        <IconButton onClick={copy} title="Copy the JSON" aria-label="Copy the JSON">
          {copied ? <CheckIcon className="text-ok size-3.5" /> : <CopyIcon className="size-3.5" />}
        </IconButton>
      </div>
      <pre className="cp-transcript max-h-96 overflow-auto font-mono text-xs">{json}</pre>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
