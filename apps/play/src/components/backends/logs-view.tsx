"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { TextInput } from "@/components/ui/field";
import { FunctionMetricsCard } from "@/components/backends/function-metrics";
import { LogTranscript } from "@/components/backends/log-transcript";
import { cn } from "@/lib/cn";
import { bytes as formatBytes } from "@/lib/format";
import { DEFAULT_RANGE, type MetricRange, windowLabel } from "@/lib/ranges";
import type { BackendFunctionView, BackendLogs } from "@/lib/types";

/**
 * A backend's logs: pick a function, read its last hour.
 *
 * ## Why the function list is searched rather than selected
 *
 * An environment has around 165 Lambdas, and the picker this replaced was a
 * native `<select>` with all of them in it: finding `create-checkout` meant
 * either typing at a select box that jumps to the first match by prefix or
 * scrolling a list the height of the page. So the list is filtered by a search
 * box instead — substring, case-insensitive, over the key — and the rows are
 * clickable, which is what makes "the function I half-remember" one keystroke
 * away rather than one scroll away.
 *
 * ## Why it remembers
 *
 * Two things are kept in `localStorage`, per stage, and both for the same
 * reason the shell keeps the selected environment: **a console that forgets what
 * you were looking at is one you re-navigate every time.** The function you last
 * opened is reopened on your next visit — a debugging session is rarely one
 * page load long — and the handful before it are offered as chips, which is the
 * history of the searches that turned out to matter.
 *
 * What is *not* stored is the query text. Restoring a filter on load would hide
 * most of the list from somebody who has not typed anything yet, and the thing
 * worth coming back to is the function, not the string that found it.
 *
 * The key is per stage rather than global, because function keys are shared
 * across environments (`extract` is `extract` everywhere) while which ones a
 * person is working on is not: `staging`'s list and `dev`'s are different
 * investigations.
 */

const HISTORY_KEY = "play-console:logs-functions";

/** How many functions the chips remember. Enough to cover a session's work. */
const RECENT_LIMIT = 8;

interface StageHistory {
  /** The function last opened in this stage, by key. */
  selected?: string;
  /** The functions before it, most recent first. */
  recent?: string[];
}

type HistoryStore = Record<string, StageHistory>;

/**
 * The store, read and written defensively.
 *
 * Private browsing, a quota, a second tab writing at the same moment — none of
 * them is worth an error in a control panel, so a store that cannot be read is
 * an empty one and one that cannot be written is a feature that quietly does
 * not persist. Losing a shortcut is not a failure; a console that throws on
 * load is.
 */
function readHistory(): HistoryStore {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HistoryStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeHistory(store: HistoryStore): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(store));
  } catch {
    // Nothing to do about it, and nothing worth saying.
  }
}

/** What this stage remembers, and how to add to it. */
function useFunctionHistory(stage: string): {
  history: StageHistory;
  remember: (key: string) => void;
} {
  // Empty on the first render and filled from an effect: the store is the
  // browser's, and rendering it during hydration would be a server and a client
  // disagreeing about the list.
  const [history, setHistory] = useState<StageHistory>({});

  useEffect(() => {
    setHistory(readHistory()[stage] ?? {});
  }, [stage]);

  const remember = useCallback(
    (key: string) => {
      const store = readHistory();
      const current = store[stage] ?? {};
      const next: StageHistory = {
        selected: key,
        recent: [key, ...(current.recent ?? []).filter((candidate) => candidate !== key)].slice(
          0,
          RECENT_LIMIT,
        ),
      };
      store[stage] = next;
      writeHistory(store);
      setHistory(next);
    },
    [stage],
  );

  return { history, remember };
}

export function LogsView({ stage }: { stage: string }) {
  const [functions, setFunctions] = useState<BackendFunctionView[]>([]);
  const [selected, setSelected] = useState("");
  const [logs, setLogs] = useState<BackendLogs | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The pattern the lines are filtered by, and the pattern in the box. */
  const [pattern, setPattern] = useState("");
  const [applied, setApplied] = useState("");
  /** One clock for the chart and the lines: see the Activity card. */
  const [range, setRange] = useState<MetricRange>(DEFAULT_RANGE);

  const { history, remember } = useFunctionHistory(stage);

  const load = useCallback(
    (fn?: string, options: { pattern?: string; minutes?: number } = {}) => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (fn) params.set("function", fn);
      if (options.pattern) params.set("q", options.pattern);
      if (options.minutes) params.set("minutes", String(options.minutes));
      const search = params.size ? `?${params.toString()}` : "";

      fetch(`/api/backends/${encodeURIComponent(stage)}/logs${search}`, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as {
            functions?: BackendFunctionView[];
            logs?: BackendLogs | null;
            error?: string;
          };
          if (!response.ok) {
            setError(body.error ?? "The logs could not be read.");
            return;
          }
          if (body.functions) setFunctions(body.functions);
          if (body.logs) setLogs(body.logs);
        })
        .catch(() => setError("The logs could not be read."))
        .finally(() => setLoading(false));
    },
    [stage],
  );

  // The list first, then one function's logs. Which one is the remembered one
  // when there is one — see the module comment — and the default otherwise: an
  // event-driven function, because those are the ones whose silence is
  // invisible everywhere else.
  useEffect(() => {
    setFunctions([]);
    setLogs(null);
    setSelected("");
    setQuery("");
    setPattern("");
    setApplied("");
    load();
  }, [stage, load]);

  useEffect(() => {
    if (selected || functions.length === 0) return;

    const remembered = history.selected
      ? functions.find((fn) => fn.key === history.selected || fn.name === history.selected)
      : undefined;

    const first = remembered ?? functions[0];
    setSelected(first.name);
    // Remembered again deliberately: it moves the function to the front of the
    // chips, which is where a person looking for it will look.
    remember(first.key);
    load(first.name, { minutes: range.minutes });
  }, [functions, selected, history.selected, remember, load, range.minutes]);

  const open = useCallback(
    (fn: BackendFunctionView) => {
      setSelected(fn.name);
      remember(fn.key);
      // The search box empties when a function is opened, which is also what
      // closes the list: the search has done its job, the logs below are what
      // somebody came for, and a panel that stays open over them is a panel in
      // the way. The function just opened is now the first chip.
      setQuery("");
      // The pattern goes with it. A filter that found a line in one function is
      // not one somebody asked to keep in the next, and a pane that looks empty
      // because a stale pattern is still in force is the worst answer there is
      // to "show me this function's logs".
      setPattern("");
      setApplied("");
      load(fn.name, { minutes: range.minutes });
    },
    [remember, load, range.minutes],
  );

  /**
   * Search the lines, rather than the lines already on screen.
   *
   * CloudWatch's own `FilterLogEvents` does the work, which is the difference
   * between searching the 200 events that fit in the pane and searching the
   * whole window — and it is why this is a button rather than a keystroke
   * filter: one press is one read, where a filter that ran as you typed would be
   * one read per character.
   */
  const searchLines = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      setPattern(next);
      setApplied(trimmed);
      if (selected) load(selected, { pattern: trimmed, minutes: range.minutes });
    },
    [load, selected, range.minutes],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return functions;
    return functions.filter(
      (fn) =>
        fn.key.toLowerCase().includes(needle) ||
        // The deployed name too, so pasting `play-dev-create-checkout` — out of
        // a stack trace, which is where these strings come from — finds it.
        fn.name.toLowerCase().includes(needle),
    );
  }, [functions, query]);

  /** The chips, minus anything this environment no longer has. */
  const recent = useMemo(
    () =>
      (history.recent ?? [])
        .map((key) => functions.find((fn) => fn.key === key))
        .filter((fn): fn is BackendFunctionView => fn !== undefined),
    [history.recent, functions],
  );

  const selectedFunction = functions.find((fn) => fn.name === selected) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeading
          title="Function"
          hint={`${functions.length} Lambda${functions.length === 1 ? "" : "s"} in ${stage}. Search for one to switch — enter opens the first match.`}
        />

        <div className="mt-5 grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-64 flex-1">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-3 left-3.5 size-4" />
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter opens the first match — the common case is typing
                  // until the right one is at the top — and Escape puts the
                  // whole list back.
                  if (event.key === "Enter" && matches.length > 0) {
                    event.preventDefault();
                    open(matches[0]);
                  }
                  if (event.key === "Escape") setQuery("");
                }}
                placeholder="create-checkout, process-video, …"
                aria-label="Search functions"
                autoComplete="off"
                spellCheck={false}
                className="pl-10"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear the search"
                  className="text-muted-foreground hover:text-foreground absolute top-3 right-3 transition-colors"
                >
                  <XIcon className="size-4" />
                </button>
              ) : null}
            </div>

            <span className="text-muted-foreground text-xs">
              {query
                ? `${matches.length} match${matches.length === 1 ? "" : "es"}`
                : `${functions.length} functions`}
            </span>
          </div>

          {/* The search history, as what it is worth keeping: the functions it
              found. Shown only when nothing is typed, because a chip row under
              an active filter is a second list competing with the first. */}
          {!query && recent.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">Recent</span>
              {recent.map((fn) => (
                <button
                  key={fn.key}
                  type="button"
                  onClick={() => open(fn)}
                  className={cn(
                    "border-border/70 rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors",
                    fn.name === selected
                      ? "bg-muted/60 text-foreground"
                      : "bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {fn.key}
                </button>
              ))}
            </div>
          ) : null}

          {/* The list, and **only while you are looking for something**. It is
              the answer to a search, not a piece of furniture: 165 names
              standing open under a search box is the panel this replaced, and
              the function you want is nearly always one you can name. The
              remembered ones above are the exception, because those you do not
              have to name. */}
          {query.trim() ? (
            <div className="max-h-72 overflow-auto">
              {matches.map((fn) => (
                <button
                  key={fn.name}
                  type="button"
                  onClick={() => open(fn)}
                  className={cn(
                    "hover:bg-accent flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors",
                    fn.name === selected && "bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono",
                      fn.name === selected && "font-medium",
                    )}
                  >
                    {fn.key}
                  </span>
                  {/* What the group holds, which is the one number a log list
                      can offer that nothing else can: it is how you find the
                      function filling CloudWatch up. Quiet functions say
                      nothing rather than "0 B". */}
                  {fn.storedBytes > 0 ? (
                    <span className="text-muted-foreground/70 shrink-0 text-xs tabular-nums">
                      {formatBytes(fn.storedBytes)}
                    </span>
                  ) : null}
                  {fn.eventDriven ? (
                    <span className="text-muted-foreground shrink-0 text-xs">event-driven</span>
                  ) : null}
                  {fn.name === selected ? (
                    <CheckIcon className="text-ok size-3.5 shrink-0" />
                  ) : null}
                </button>
              ))}

              {matches.length === 0 ? (
                <p className="text-muted-foreground px-2.5 py-2 text-xs">
                  {functions.length === 0
                    ? "No functions in this environment yet."
                    : `Nothing matching "${query}".`}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {selectedFunction ? (
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            {selectedFunction.logGroup}
          </p>
        ) : null}
      </Card>

      {/* What it did, before what it said: a chart answers "is this being
          called, and is it failing" in one look, and the transcript answers the
          question that follows. The range buttons on that card are this page's
          one clock — the lines below are read over the same window. */}
      <FunctionMetricsCard
        stage={stage}
        fn={selectedFunction}
        range={range}
        onRangeChange={(next) => {
          setRange(next);
          if (selected) load(selected, { pattern: applied, minutes: next.minutes });
        }}
      />

      {error ? (
        <Card>
          <p className="text-destructive font-mono text-xs whitespace-pre-wrap">{error}</p>
        </Card>
      ) : null}

      <Card flush className="pb-4">
        <div className="flex flex-wrap items-center gap-3 px-6 pt-6">
          <h2 className="text-base font-semibold tracking-tight">
            Last {windowLabel(range.minutes)}
          </h2>
          {loading ? <Chip tone="run">reading</Chip> : null}
          {applied ? (
            <Chip tone="accent" title={`Filtered by ${applied}`}>
              filtered
            </Chip>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            className="ml-auto font-mono"
            onClick={() => selected && load(selected, { pattern: applied, minutes: range.minutes })}
            busy={loading}
          >
            refresh
          </Button>
        </div>

        {/* Searching the lines, which is not the same as searching what is on
            screen: this goes to CloudWatch as a filter pattern over the whole
            window, so it finds the one error in an hour of noise rather than the
            one already in front of you. CloudWatch's own syntax works here —
            `"two words"` for a phrase, `?one ?two` for either, `{ $.level = "error" }`
            for a JSON term — which is why the hint says so rather than pretending
            it is a plain substring. */}
        <form
          className="mt-4 flex flex-wrap items-end gap-3 px-6"
          onSubmit={(event) => {
            event.preventDefault();
            searchLines(pattern);
          }}
        >
          <div className="min-w-64 flex-1">
            <TextInput
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setPattern("");
                  if (applied) searchLines("");
                }
              }}
              placeholder="filter the lines — a word, a phrase in quotes, or a JSON term"
              aria-label="Filter the log lines"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" size="sm" busy={loading} icon={<SearchIcon className="size-3.5" />}>
            search
          </Button>
          {applied || pattern ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPattern("");
                searchLines("");
              }}
            >
              clear
            </Button>
          ) : null}
        </form>

        <div className="cp-transcript mt-4 max-h-96 overflow-auto px-6">
          <LogTranscript events={logs?.events ?? []} note={logs?.note ?? null} />
        </div>
      </Card>
    </div>
  );
}
