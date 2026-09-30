"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { ConsoleState, EnvironmentView, RunSummary } from "@/lib/types";

/**
 * What the whole console knows: who we are, what environments exist, which one
 * is selected, and what is deploying.
 *
 * One fetch, one place to refresh from, and one selection shared by both pages
 * — because the environment a frontend is started against is the environment
 * the deploy page is about, and a second copy of "which stage" is a second
 * answer to the same question.
 *
 * The state is read once and then re-read on focus and every thirty seconds.
 * That is not live-ness for its own sake: a deploy changes stack statuses, and
 * a rail that still says "not deployed" after a deploy finishes is worse than
 * one that says nothing.
 *
 * ## Why the runs are a second read, on their own clock
 *
 * A deploy's progress is the opposite kind of fact from a stack's status: it is
 * free to read (it is this process's own memory), and it is stale within seconds.
 * So it comes from `/api/deploy/runs` — a summary per run, not the run — rather
 * than from the state above, which is cached and costs two `aws` processes. It
 * lives here because three pages need the same answer: the list of environments,
 * one environment's page, and the deploy page's own card. A row that said
 * "deploying" above a header that said "partly deployed" would be two answers to
 * one question.
 */

const STAGE_KEY = "play-console:stage";

const REFRESH_MS = 30_000;

/** How often the list of running deploys is re-read, going and idle. */
const RUNNING_MS = 3_000;
const IDLE_MS = 15_000;

interface ShellValue {
  state: ConsoleState | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
  /** Every selectable stage: the ones on disk, then any named in this session. */
  stages: string[];
  stage: string;
  setStage: (stage: string) => void;
  environment: EnvironmentView | null;
  /** A stage nobody has a config for yet — what the deploy page creates. */
  unknown: boolean;
  /**
   * Every backend deploy going right now, whatever environment it is about.
   *
   * Summaries rather than whole runs: this is read every three seconds to draw a
   * chip and a step number, and the paragraph behind each step is most of what a
   * run is.
   */
  runs: RunSummary[];
  /**
   * Read them again now.
   *
   * The read schedules itself — three seconds while something is deploying,
   * fifteen when nothing is — which is right for a page somebody is watching and
   * too slow for a button that has just started a run: the row would say
   * "deploying" up to fifteen seconds later, which reads as a button that did
   * nothing.
   */
  refreshRuns: () => void;
}

const ShellContext = createContext<ShellValue | null>(null);

/** Adds a stage that does not exist on disk yet, and selects it. */
const NamedStageContext = createContext<(stage: string) => void>(() => {});

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <ShellProvider>.");
  return value;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [named, setNamed] = useState<string[]>([]);
  const [stage, setStageState] = useState("dev");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  /** Bumped to ask for the runs again before the schedule's next turn. */
  const [runsTick, setRunsTick] = useState(0);
  const inFlight = useRef(false);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (mode === "refresh") setRefreshing(true);
    try {
      // `?fresh` skips the server's five-second cache, which is exactly what
      // the refresh button and a window focus are asking for.
      const response = await fetch(mode === "refresh" ? "/api/state?fresh=1" : "/api/state", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`The console could not read the repository (HTTP ${response.status}).`);
      }
      const next = (await response.json()) as ConsoleState;
      setState(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load("initial");

    const onFocus = () => void load("refresh");
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void load("refresh"), REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [load]);

  /**
   * The deploys going right now.
   *
   * A self-scheduling read rather than an interval, because the delay depends on
   * the answer: three seconds while something is deploying, fifteen when nothing
   * is — which is still often enough to notice a run started from another tab or
   * another page, and cheap enough to leave open. Nothing here is cached, so
   * there is no `?fresh` and no reason to read it on focus.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const read = async () => {
      let next: RunSummary[] = [];
      try {
        const response = await fetch("/api/deploy/runs", { cache: "no-store" });
        if (response.ok) {
          next = ((await response.json()) as { runs: RunSummary[] }).runs;
        }
      } catch {
        // A list that could not be read is a list that says nothing is
        // deploying, which is where it started. The deploy page has its own
        // stream and is unaffected.
      }
      if (cancelled) return;
      setRuns(next);
      timer = setTimeout(read, next.length > 0 ? RUNNING_MS : IDLE_MS);
    };

    void read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runsTick]);

  // The selection survives a reload, because a console that forgets which
  // environment you were looking at is a console you re-navigate every time.
  useEffect(() => {
    const stored = window.localStorage.getItem(STAGE_KEY);
    if (stored) setStageState(stored);
  }, []);

  const setStage = useCallback((next: string) => {
    setStageState(next);
    window.localStorage.setItem(STAGE_KEY, next);
  }, []);

  const stages = useMemo(() => {
    const fromState = (state?.environments ?? []).map((environment) => environment.stage);
    const all = [...fromState, ...named];
    return [...new Set(all)].sort((a, b) =>
      a === "dev" ? -1 : b === "dev" ? 1 : a.localeCompare(b),
    );
  }, [state, named]);

  // A stage stored from a previous session, or named here, is still selectable
  // even when the repository does not know it — that is what "deploy to a new
  // environment" means, and the rail should not refuse to show it.
  useEffect(() => {
    if (stages.length > 0 && !stages.includes(stage)) setStage(stages[0]);
  }, [stages, stage, setStage]);

  const environment = useMemo(
    () => state?.environments.find((candidate) => candidate.stage === stage) ?? null,
    [state, stage],
  );

  const value = useMemo<ShellValue>(
    () => ({
      state,
      error,
      loading,
      refreshing,
      refresh: () => void load("refresh"),
      stages,
      stage,
      setStage,
      environment,
      unknown: environment === null,
      runs,
      refreshRuns: () => setRunsTick((tick) => tick + 1),
    }),
    [state, error, loading, refreshing, load, stages, stage, setStage, environment, runs],
  );

  // A stage named here is added to the picker immediately, so the deploy page
  // can start a run for it without waiting for a config file to appear.
  const addNamed = useCallback((next: string) => {
    setNamed((current) => (current.includes(next) ? current : [...current, next]));
    setStage(next);
  }, [setStage]);

  return (
    <ShellContext.Provider value={value}>
      <NamedStageContext.Provider value={addNamed}>{children}</NamedStageContext.Provider>
    </ShellContext.Provider>
  );
}

export function useNameStage(): (stage: string) => void {
  return useContext(NamedStageContext);
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

export type Theme = "light" | "dark";

const THEME_KEY = "play-console:theme";

/**
 * Dark by default, with a way out.
 *
 * A console is a room with a transcript in it, and a terminal is not the thing
 * to read in daylight — so `dark` is what a first visit gets and what the
 * document carries before React runs. The toggle is here because somebody
 * reading a stack trace at noon deserves a choice, and it is a subscription
 * rather than a provider stack.
 *
 * The choice is not kept in React. It already lives in two places React does
 * not own — the class the head script puts on `<html>` before the first paint,
 * and the `localStorage` entry behind it — so React reads the document and is
 * told when it changes. A `useState` copy is what made light mode fail to
 * survive a reload: with one effect reading the stored value and another
 * writing the state, the write ran during the mount commit, before the read had
 * been applied, and the default was stored over the choice.
 */
const themeListeners = new Set<() => void>();

function subscribeTheme(onChange: () => void): () => void {
  themeListeners.add(onChange);
  return () => {
    themeListeners.delete(onChange);
  };
}

/** The document is the record here, not a mirror of one. */
function themeSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** What the server renders, and so what hydration must agree with. */
function themeOnServer(): Theme {
  return "dark";
}

/** The one place the choice is written: `<html>`, its storage, its readers. */
function applyTheme(next: Theme): void {
  document.documentElement.classList.toggle("dark", next === "dark");
  window.localStorage.setItem(THEME_KEY, next);
  for (const listener of themeListeners) listener();
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, themeOnServer);

  return {
    theme,
    toggle: () => applyTheme(theme === "dark" ? "light" : "dark"),
  };
}
