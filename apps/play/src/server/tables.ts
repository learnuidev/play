import type {
  TableDetailView,
  TableIndexView,
  TableItemsView,
  TableKeyView,
  TableSummaryView,
  TableSummaryList,
} from "@/lib/types";
import { awsJson } from "./aws";
import { readConfig } from "./environments";

/**
 * The environment's DynamoDB tables, read out of the account.
 *
 * ## Why the list is one call and the counts are another
 *
 * `ListTables` answers with names and nothing else, and there is no batch
 * `DescribeTable` — so a table's row count, size and key schema are one API call
 * *per table*, and a migrated environment has twenty-nine of them. Drawing that
 * on every page load would be twenty-nine calls to draw a strip of tabs, which
 * is the same arithmetic that made the Logs tab ask for one function at a time.
 * So the list is the list, and everything else is read when a table is opened.
 *
 * ## Where the names come from, and why they look different from each other
 *
 * Two sources, and the console shows which one a name came from because it
 * changes what a person may do with it:
 *
 * - **A stage that imports its data names every table** in its config
 *   (`existing.tables`, keyed by the logical id the CDK app uses). Those are the
 *   product's own tables, shared with every other importing stage, unmanaged by
 *   any deploy — and the row says `imported` in as many words.
 * - **A stage that creates its data has tables named after itself**:
 *   `play-<stage>-<name>`, made by `PlayDataStack` from the table specs in
 *   `infra/src/generated/service.ts`. Nothing in this repository lists them at
 *   runtime, and the console deliberately does not keep a copy of that list: a
 *   second copy is a list that goes wrong the day a table is added, which is
 *   exactly what the account can be asked instead.
 *
 * The label a row shows is therefore the config's own key when the file names
 * one, and the name with the stage prefix taken off when it does not — with the
 * physical name beside it, because that is the string somebody pastes into a
 * CLI.
 *
 * ## Read-only, on purpose
 *
 * Nothing in this module writes. `DescribeTable`, `Query` and `Scan` are reads;
 * there is no `PutItem` in the console, and there is no text box that turns into
 * one. A control room that can edit the product's rows is a control room where a
 * typo is data loss with no undo, and the console's own rule — every AWS call is
 * a `describe`, a `list` or a `get` — is what this tab is held to as well.
 */

export interface AwsReadContext {
  profile?: string;
  region?: string;
}

/** How many rows a page of the browser asks for. */
const PAGE_SIZE = 25;

/* ------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------ */

/**
 * Every table this stage reads — see the module comment for the two sources.
 *
 * Exported because the delete plan asks the same question with the same two
 * sources, and it must get the same answer: a table this tab lists and the plan
 * does not delete is a table left behind, and one the plan deletes and this tab
 * never showed is worse.
 */
export async function stageTableNames(
  stage: string,
  ctx: AwsReadContext = {},
): Promise<string[]> {
  const listed = await awsJson<{ TableNames?: string[] }>(["dynamodb", "list-tables"], {
    ...ctx,
    optional: true,
  }).catch(() => null);

  const held = new Set(listed?.TableNames ?? []);
  const config = readConfig(stage);

  const names = new Set<string>();
  // The intersection matters more than the union: a config naming a table
  // somebody deleted by hand is not a table that exists, and listing it would be
  // a row that fails the moment it is opened.
  for (const name of Object.values(config?.existing?.tables ?? {})) {
    if (held.has(name)) names.add(name);
  }
  for (const name of held) {
    if (name.startsWith(`play-${stage}-`)) names.add(name);
  }

  return [...names].sort();
}

export async function backendTables(
  stage: string,
  ctx: AwsReadContext = {},
): Promise<TableSummaryList> {
  const config = readConfig(stage);
  const imported = new Map(
    Object.entries(config?.existing?.tables ?? {}).map(([id, name]) => [name, id]),
  );

  const names = await stageTableNames(stage, ctx);

  const tables: TableSummaryView[] = names.map((name) => {
    const logical = imported.get(name) ?? null;
    return {
      name,
      key: logical ?? name.slice(`play-${stage}-`.length),
      logical,
      imported: logical !== null,
    };
  });

  // Sorted by the label rather than by the physical name: a migrated stage's
  // names all begin with the same three parts, so the name is the part that
  // sorts last and the label is the part a person is scanning for.
  tables.sort((a, b) => a.key.localeCompare(b.key));

  return {
    tables,
    note: tables.length
      ? null
      : `No tables for ${stage}. Either this environment has not deployed its data stack yet, or its data lives in another stage's account.`,
  };
}

/* ------------------------------------------------------------------ *
 * One table's shape
 * ------------------------------------------------------------------ */

interface RawKeySchema {
  AttributeName?: string;
  KeyType?: string;
}

interface RawTableDescription {
  TableName?: string;
  TableStatus?: string;
  ItemCount?: number;
  TableSizeBytes?: number;
  BillingModeSummary?: { BillingMode?: string };
  CreationDateTime?: string;
  KeySchema?: RawKeySchema[];
  AttributeDefinitions?: Array<{ AttributeName?: string; AttributeType?: string }>;
  GlobalSecondaryIndexes?: Array<{
    IndexName?: string;
    KeySchema?: RawKeySchema[];
    Projection?: { ProjectionType?: string };
  }>;
}

/**
 * A key a query can be answered from.
 *
 * The table's own partition key, and the partition key of each of its indexes.
 * A **query** needs one of these — a `KeyConditionExpression` has to name a
 * partition key — and anything else is a scan with a filter, which reads every
 * row to return a few. That is the whole reason this is discovered rather than
 * guessed: the difference between the two is not style, it is what the call
 * costs.
 */
interface QueryTarget {
  /** Null for the table itself; an index name for one of its indexes. */
  indexName: string | null;
  /** What to show a person: `userId`, or `spaceId via SpaceCreatedIndex`. */
  label: string;
  hash: string;
  hashType: string;
  range: string | null;
  rangeType: string | null;
}

export interface TableShape {
  detail: TableDetailView;
  targets: QueryTarget[];
}

export async function describeTable(
  stage: string,
  name: string,
  ctx: AwsReadContext = {},
): Promise<TableShape> {
  const body = await awsJson<{ Table?: RawTableDescription }>(
    ["dynamodb", "describe-table", "--table-name", name],
    ctx,
  );

  const table = body?.Table;
  if (!table) throw new Error(`describe-table answered nothing for ${name}.`);

  const types = new Map(
    (table.AttributeDefinitions ?? []).map((attribute) => [
      attribute.AttributeName ?? "",
      attribute.AttributeType ?? "S",
    ]),
  );
  const keysOf = (schema: RawKeySchema[] | undefined): TableKeyView[] =>
    (schema ?? [])
      .filter((key) => key.AttributeName)
      .map((key) => ({
        name: key.AttributeName as string,
        type: types.get(key.AttributeName as string) ?? "S",
        kind: key.KeyType === "RANGE" ? "RANGE" : "HASH",
      }));

  const keys = keysOf(table.KeySchema);
  const hash = keys.find((key) => key.kind === "HASH") ?? null;
  const range = keys.find((key) => key.kind === "RANGE") ?? null;

  const indexes: TableIndexView[] = (table.GlobalSecondaryIndexes ?? [])
    .filter((index) => index.IndexName)
    .map((index) => ({
      name: index.IndexName as string,
      keys: keysOf(index.KeySchema),
      projection: index.Projection?.ProjectionType ?? "ALL",
    }));

  const targets: QueryTarget[] = hash
    ? [
        {
          indexName: null,
          label: hash.name,
          hash: hash.name,
          hashType: hash.type,
          range: range?.name ?? null,
          rangeType: range?.type ?? null,
        },
        ...indexes.flatMap((index) => {
          const indexHash = index.keys.find((key) => key.kind === "HASH");
          const indexRange = index.keys.find((key) => key.kind === "RANGE");
          if (!indexHash) return [];
          return [
            {
              indexName: index.name,
              label: `${indexHash.name} via ${index.name}`,
              hash: indexHash.name,
              hashType: indexHash.type,
              range: indexRange?.name ?? null,
              rangeType: indexRange?.type ?? null,
            },
          ];
        }),
      ]
    : [];

  return {
    detail: {
      name: table.TableName ?? name,
      status: table.TableStatus ?? "UNKNOWN",
      itemCount: table.ItemCount ?? 0,
      sizeBytes: table.TableSizeBytes ?? 0,
      billingMode: table.BillingModeSummary?.BillingMode ?? null,
      created: table.CreationDateTime ? Date.parse(table.CreationDateTime) : null,
      keys,
      indexes,
      targets: targets.map((target) => target.label),
    },
    targets,
  };
}

/* ------------------------------------------------------------------ *
 * A page of the data
 * ------------------------------------------------------------------ */

export interface TableQuery {
  /** The attribute to look at. Absent means "whatever order the table is in". */
  attribute?: string;
  /** `=`, `begins_with`, `contains`, `>` or `<`. Defaults to `=`. */
  operator?: string;
  value?: string;
  /** How the value is typed in the expression: `S`, `N` or `BOOL`. */
  type?: string;
  /** The CLI's own opaque cursor, handed straight back to it. */
  token?: string;
  limit?: number;
}

interface RawPage {
  Items?: Array<Record<string, unknown>>;
  Count?: number;
  ScannedCount?: number;
  NextToken?: string;
}

/** The operators a filter may use, and how each becomes an expression. */
const OPERATORS = ["=", "begins_with", "contains", ">", "<"] as const;

export async function readTableItems(
  shape: TableShape,
  query: TableQuery,
  ctx: AwsReadContext = {},
): Promise<TableItemsView> {
  const limit = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), 100);
  const attribute = query.attribute?.trim() ?? "";
  const raw = query.value ?? "";
  const operator = (query.operator ?? "=").trim();

  // A value with no attribute is a filter nobody can read, and an attribute with
  // no value is one that matches nothing. Both are refused here rather than sent
  // to DynamoDB, whose own complaint about either is a syntax error rather than
  // a sentence about the form.
  if (raw !== "" && !attribute) {
    throw new Error("Name the attribute to match, or clear the value to read the table as it is.");
  }
  if (attribute && raw === "") {
    throw new Error(`"${attribute}" needs a value to match against.`);
  }
  if (attribute && !OPERATORS.includes(operator as (typeof OPERATORS)[number])) {
    throw new Error(`"${operator}" is not one of ${OPERATORS.join(", ")}.`);
  }

  const typed = attribute ? typedValue(raw, query.type ?? typeFor(shape, attribute)) : null;
  // What the value was compared *as*, which the form may have left to the table
  // to decide. Reported back because it is the answer to the question a read
  // that matched nothing raises: an `N` compared as an `S` matches nothing, and
  // only one of the two is visible in the value somebody typed.
  const resolvedType = attribute ? (query.type ?? typeFor(shape, attribute)) : null;

  // One expression-attribute name is enough: the form asks about one attribute,
  // and aliasing it as `#a` is also what keeps a reserved word — `status`, `size`,
  // `name` — from being a syntax error.
  const names = attribute ? { "#a": attribute } : undefined;
  const values = typed ? { ":v": typed } : undefined;

  const target = attribute ? shape.targets.find((candidate) => candidate.hash === attribute) : null;
  const via: "query" | "scan" = target && operator === "=" ? "query" : "scan";
  const expression = !attribute ? null : via === "query" ? "#a = :v" : filterOf(operator);

  const argv =
    via === "query"
      ? [
          "dynamodb",
          "query",
          "--table-name",
          shape.detail.name,
          ...(target?.indexName ? ["--index-name", target.indexName] : []),
          "--key-condition-expression",
          expression as string,
          ...(names ? ["--expression-attribute-names", JSON.stringify(names)] : []),
          ...(values ? ["--expression-attribute-values", JSON.stringify(values)] : []),
        ]
      : [
          "dynamodb",
          "scan",
          "--table-name",
          shape.detail.name,
          ...(expression
            ? [
                "--filter-expression",
                expression,
                "--expression-attribute-names",
                JSON.stringify(names),
                "--expression-attribute-values",
                JSON.stringify(values),
              ]
            : []),
        ];

  argv.push("--max-items", String(limit));
  if (query.token) argv.push("--starting-token", query.token);

  const page = await awsJson<RawPage>(argv, ctx);
  const items = page?.Items ?? [];
  const matched = page?.Count ?? items.length;
  const scanned = page?.ScannedCount ?? matched;

  return {
    via,
    expression: attribute
      ? describeQuery(via, expression as string, attribute, operator, raw, resolvedType ?? "S")
      : null,
    valueType: resolvedType,
    indexName: via === "query" ? (target?.indexName ?? null) : null,
    // The rows are sent **exactly as DynamoDB answered** — `{ paymentId: { S: "…" } }`
    // — and rendered in the browser by `lib/dynamo`. One read, two renderings (a
    // table and JSON), and a mapping here would be a second answer to "what does
    // this row say" that only one of the two would be drawn from.
    rows: items,
    matched,
    scanned,
    token: page?.NextToken ?? null,
    note: noteFor({
      via,
      attribute,
      value: raw,
      type: resolvedType,
      matched,
      scanned,
      items,
    }),
  };
}

/**
 * The value as DynamoDB's wire format wants it.
 *
 * Typed from the form rather than guessed from the text, and that is the one
 * place this tab refuses to be clever: `42` compared against a **number** and
 * `"42"` compared against a **string** are different reads, and a value that
 * guessed would return nothing with no way to tell why. The form defaults the
 * type from the key schema when the attribute is a key, so the common case needs
 * no decision, and shows what it picked.
 */
function typedValue(raw: string, type: string): Record<string, unknown> {
  const value = raw.trim();

  if (type === "N") {
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      throw new Error(`"${raw}" is not a number, and the attribute is one — DynamoDB stores them separately.`);
    }
    return { N: value };
  }
  if (type === "BOOL") {
    if (value !== "true" && value !== "false") {
      throw new Error(`A boolean is "true" or "false", not "${raw}".`);
    }
    return { BOOL: value === "true" };
  }
  return { S: raw };
}

/** The type to offer for an attribute, from whatever the table says it is. */
export function typeFor(shape: TableShape, attribute: string): string {
  for (const target of shape.targets) {
    if (target.hash === attribute) return target.hashType;
    if (target.range === attribute) return target.rangeType ?? "S";
  }
  const key = shape.detail.keys.find((candidate) => candidate.name === attribute);
  return key?.type ?? "S";
}

/** The operator as the expression syntax spells it. */
function filterOf(operator: string): string {
  if (operator === "begins_with") return "begins_with(#a, :v)";
  if (operator === "contains") return "contains(#a, :v)";
  return `#a ${operator} :v`;
}

/**
 * What the read was, in a sentence.
 *
 * The tab says which call it made, because the two are not the same read: a
 * `Query` on a key costs one round trip and a few rows, and a `Scan` with a
 * filter reads the whole table to return the ones that match. A console that
 * hid that would teach somebody to filter a big table on a non-key attribute
 * without noticing what it cost — so the sentence names the call, and the row
 * underneath counts what it read.
 *
 * **The type is always in it**, in words rather than as `S` or `N`. It is the
 * half of a comparison nobody can see in what they typed, and it is the answer
 * to the commonest empty result there is: an attribute stored as a number,
 * matched against the digits somebody read off a screen as a string.
 */
function describeQuery(
  via: "query" | "scan",
  expression: string,
  attribute: string,
  operator: string,
  value: string,
  type: string,
): string {
  const spelled = expression.replace("#a", attribute).replace(":v", JSON.stringify(value));
  const read =
    via === "query"
      ? `Query on the key: ${spelled}`
      : `Scan with a filter (${operator}): ${spelled}`;
  return `${read} · ${typeWord(type)}`;
}

/** `S` → `string`. The wire type is not what a person is being asked about. */
function typeWord(type: string): string {
  switch (type) {
    case "S":
      return "string";
    case "N":
      return "number";
    case "BOOL":
      return "boolean";
    default:
      return type;
  }
}

function noteFor(input: {
  via: "query" | "scan";
  attribute: string;
  value: string;
  type: string | null;
  matched: number;
  scanned: number;
  items: Array<Record<string, unknown>>;
}): string | null {
  if (input.items.length === 0) {
    if (!input.attribute) {
      return "This table is empty.";
    }

    // The one empty result worth explaining rather than merely reporting. A
    // value of digits compared as a string is the mistake this form makes easy —
    // `42` and `"42"` read identically and are different attributes as far as
    // DynamoDB is concerned — and saying so saves the next ten minutes.
    const looksNumeric = input.type === "S" && /^-?\d+(\.\d+)?$/.test(input.value.trim());
    const typed = looksNumeric
      ? ` "${input.value}" looks like a number: if the attribute is stored as one, set As to number — DynamoDB keeps a number and the string that reads the same apart.`
      : "";

    if (input.via === "query") {
      return `Nothing matched that key.${typed}`;
    }
    return `Nothing matched. The scan looked at ${plural(input.scanned, "row")} before stopping — a filter is applied after the read, so a page of matches is not the same as a page of rows.${typed}`;
  }
  if (input.via === "scan" && input.scanned > input.matched) {
    return `${input.scanned} rows read to return ${input.matched} — a filter is applied after the read.`;
  }
  return null;
}

/** `29 rows`, `1 row` — the same wording the page uses. */
function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}
