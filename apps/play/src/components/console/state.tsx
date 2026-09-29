"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ConsoleState, EnvironmentView } from "@/lib/types";

/**
 * What the whole console knows: who we are, what environments exist, and which
 * one is selected.
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
 */

const STAGE_KEY = "play-console:stage";

const REFRESH_MS = 30_000;

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
    }),
    [state, error, loading, refreshing, load, stages, stage, setStage, environment],
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
 * reading a stack trace at noon deserves a choice, and it is four lines of
 * state rather than a provider stack.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
