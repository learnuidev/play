import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { repoPath } from "./repo";

import type {
  LogLine,
  VercelLoginEvent,
  VercelLoginStep,
  VercelLoginView,
} from "@/lib/types";
import { display, lastMeaningfulLines, run as runCommand, type PipedChild } from "./exec";

/**
 * The Vercel CLI, as this machine has it.
 *
 * Two things live here, and they are the same subject: **where the `vercel`
 * binary is**, and **the sign-in run** the console starts on the page's behalf.
 * The console does not otherwise drive the CLI — the integration's reads are
 * REST calls, and `server/vercel.ts` says why — but a login is exactly what a
 * CLI is for: an OAuth device flow, printed as a URL, approved in a browser, and
 * written to the CLI's own store where `vercel whoami` can confirm it.
 *
 * ## Why the install is part of it
 *
 * "Connect Vercel" on a machine with no CLI would otherwise be a button that
 * cannot work. So the first step is the CLI's presence, and the console installs
 * it the way this workspace's users install anything global — `pnpm i -g` — then
 * carries straight on into the login. `npm` is the fallback for a machine
 * without pnpm, and the transcript says which one ran, because a global install
 * is a change to the machine and not a detail to hide.
 *
 * ## Why the run outlives the page
 *
 * The flow waits for a person, and the person is in another tab — a device code
 * is approved in a browser, and a page reload, a closed tab or a walk to the
 * kettle is normal. So the run is a singleton on `globalThis`, its output is
 * buffered, and a page that arrives late is handed what it missed and follows
 * from there. What it does *not* outlive is the console: an abandoned sign-in
 * holding a socket open is nobody's to clean up, so the exit handlers end it.
 */

const MAX_LINES = 400;

/**
 * What every `vercel` invocation from here is given.
 *
 * `NO_UPDATE_NOTIFIER` turns off the CLI's version check, which otherwise runs
 * before the command does: a network call, a cache directory it has to be
 * allowed to write, and a line of upgrade advice printed into the middle of a
 * transcript. The CLI throws the same switch for itself whenever `VERCEL` is set
 * — that is, whenever it is running somewhere that is not a person's terminal,
 * which is exactly what this is.
 */
function cliEnv(): Record<string, string> {
  return { NO_UPDATE_NOTIFIER: "1", ...cliStoreEnv() };
}

/** Five minutes for a global install: registry time, not a hang. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/**
 * Twenty minutes for the login.
 *
 * The device code the CLI asks Vercel for has its own expiry — around fifteen
 * minutes — and the CLI polls until then and reports "Timed out waiting for
 * authentication" itself. This is the backstop for a process that never gets
 * that far, so the run can always end in a sentence rather than in a spinner.
 */
const LOGIN_TIMEOUT_MS = 20 * 60_000;

/* ------------------------------------------------------------------ *
 * Finding the CLI
 * ------------------------------------------------------------------ */

/**
 * `which vercel`, without a shell.
 *
 * A path lookup rather than `vercel --version`, and the difference matters: the
 * CLI checks npm for a newer version on every run, which on this machine is a
 * network call and a cache write, and asking "is it installed?" every time the
 * page loads should not cost that. `PNPM_HOME` is searched as well as `PATH`
 * because that is where `pnpm i -g` puts its binaries, and the console is
 * started from a terminal whose `PATH` may have been set before pnpm was.
 */
export function vercelCliPath(): string | null {
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    process.env.PNPM_HOME ?? "",
  ].filter(Boolean);

  for (const dir of dirs) {
    const candidate = path.join(dir, process.platform === "win32" ? "vercel.cmd" : "vercel");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }

  return null;
}

/**
 * Where a session can live.
 *
 * `vercel login` writes `auth.json` into the CLI's own store — `xdg-app-paths`
 * under the name `com.vercel.cli`, which is `~/Library/Application Support` on
 * macOS, `$XDG_DATA_HOME` (or `~/.local/share`) elsewhere and `%APPDATA%` on
 * Windows — and the console *reads* it from there, which is what makes a session
 * created in somebody's terminal the console's session too.
 *
 * What the console cannot always do is **create** one there. A console started
 * inside a container, a CI job, or any sandbox that confines it to the
 * repository gets `EPERM` on that path: the device flow completes, the CLI has
 * the tokens, and the write that would keep them is refused —
 *
 *     Error: Not able to create ~/Library/Application Support/com.vercel.cli/
 *     auth.json (operation not permitted).
 *
 * So when the CLI's own store is not writable, the login is given XDG
 * directories **inside the repository** instead. The session then lives beside
 * the `.env.local` a pasted token goes in, in `apps/play/.vercel-cli` — which is
 * gitignored, and which the console says out loud when it uses it, because a
 * session there is one a terminal's `vercel` will not see. A console that cannot
 * sign in at all would be worse than one whose session lives beside it.
 */
function storeDirs(): { standard: string[]; local: string } {
  const home = os.homedir();
  const standard =
    process.platform === "darwin"
      ? [path.join(home, "Library", "Application Support")]
      : process.platform === "win32"
        ? [process.env.APPDATA ?? path.join(home, "AppData", "Roaming")]
        : [
            process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
            process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
          ];

  return {
    standard: standard.map((dir) => path.join(dir, "com.vercel.cli")),
    local: repoPath("apps", "play", ".vercel-cli", "com.vercel.cli"),
  };
}

/** Whether a directory exists and would accept a file — creating it if needed. */
function writable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch {
    // Not there yet: the question is whether it could be made.
    try {
      fs.accessSync(path.dirname(dir), fs.constants.W_OK | fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Every store a session could be in, the CLI's own first.
 *
 * Both are read whatever the answer to the writability question: a store that
 * cannot be *written* can still hold a perfectly good session from a terminal,
 * which is exactly the case in the container above.
 */
export function cliAuthFiles(): string[] {
  const { standard, local } = storeDirs();
  return [...standard, local].map((dir) => path.join(dir, "auth.json"));
}

/**
 * The environment that tells the CLI to keep its session in the repository.
 *
 * Empty when the CLI's own store is usable — the common case, and the one where
 * the console and the terminal share one session.
 */
export function cliStoreEnv(): Record<string, string> {
  const { standard, local } = storeDirs();
  if (standard.some(writable)) return {};
  return { XDG_DATA_HOME: path.dirname(local), XDG_CONFIG_HOME: path.dirname(local) };
}

/** Unix seconds against the clock; a session with no `expiresAt` never lapses. */
export function lapsed(expiresAt: number | null): boolean {
  return expiresAt !== null && expiresAt * 1000 <= Date.now();
}

interface CliSession {
  token: string;
  expiresAt: number | null;
  file: string;
}

function readSession(file: string): CliSession | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      token?: unknown;
      expiresAt?: unknown;
    };
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    return {
      token: parsed.token,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
      file,
    };
  } catch {
    return null;
  }
}

/**
 * The CLI's token, as the CLI last wrote it.
 *
 * Read rather than copied anywhere: the file is the CLI's, `vercel logout`
 * belongs in a terminal, and a second copy of a credential is a second thing to
 * go stale. `expiresAt` comes along because Vercel issues the CLI a short-lived
 * access token that the CLI itself refreshes with the refresh token beside it —
 * a token that has lapsed reads as "sign in again" rather than as a mystery 403.
 *
 * A live session wins over a lapsed one wherever it is: a store the console
 * could not renew is no reason to ignore the one it made for itself.
 */
export function cliToken(): CliSession | null {
  const sessions = cliAuthFiles()
    .map(readSession)
    .filter((session): session is CliSession => session !== null);

  return sessions.find((session) => !lapsed(session.expiresAt)) ?? sessions[0] ?? null;
}

export function vercelCliView(): { installed: boolean; path: string | null; tokenExpiresAt: number | null } {
  const binary = vercelCliPath();
  return {
    installed: binary !== null,
    path: binary,
    tokenExpiresAt: cliToken()?.expiresAt ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Opening the device page
 * ------------------------------------------------------------------ */

/**
 * The platform's way of saying "put this in front of me".
 *
 * The console opens the URL it parsed rather than leaving it to the CLI, and the
 * reason is not redundancy: the CLI *does* try — unless it decides nobody is
 * watching, which is what a process with no terminal looks like to it — and it
 * does so silently, catching the failure into a debug log. This is the one step
 * of the flow a person actually has to take, so it is taken where the console
 * can watch it happen and say so.
 */
const OPENER: Record<string, [string, string[]]> = {
  darwin: ["open", []],
  win32: ["cmd", ["/c", "start", ""]],
  linux: ["xdg-open", []],
};

/** A browser that was asked is not a browser that answered, so this is short. */
const OPEN_TIMEOUT_MS = 15_000;

async function openDevicePage(run: LoginRun, url: string): Promise<void> {
  const [binary, prefix] = OPENER[process.platform] ?? OPENER.linux;

  try {
    const result = await runCommand(binary, [...prefix, url], { timeoutMs: OPEN_TIMEOUT_MS });

    if (result.code === 0 || result.timedOut) {
      // `xdg-open` holds the terminal until the browser exits; on macOS `open`
      // returns at once. Either way the URL has been handed over.
      appendLine(run, "note", "opened the device page in your browser — approve the code there");
      return;
    }

    const detail = lastMeaningfulLines(result.stderr || result.stdout, 1)[0];
    appendLine(
      run,
      "note",
      `could not open a browser (\`${display(binary, [...prefix, url])}\` exited with ` +
        `${result.code ?? result.signal}${detail ? `: ${detail}` : ""}) — open the link above yourself`,
    );
  } catch (error) {
    appendLine(
      run,
      "note",
      `could not open a browser (${message(error)}) — open the link above yourself`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * The sign-in run
 * ------------------------------------------------------------------ */

interface LoginRun {
  view: VercelLoginView;
  lines: LogLine[];
  listeners: Set<(event: VercelLoginEvent) => void>;
  child: PipedChild | null;
  cancelled: boolean;
  seq: number;
}

interface Store {
  run: LoginRun | null;
  /** On the store rather than in a module, so a hot reload cannot double up. */
  cleanupInstalled: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __playVercelLogin: Store | undefined;
}

const store: Store = (globalThis.__playVercelLogin ??= {
  run: null,
  cleanupInstalled: false,
});

const IDLE: VercelLoginView = {
  status: "idle",
  step: null,
  startedAt: null,
  finishedAt: null,
  url: null,
  error: null,
  lineCount: 0,
};

export function vercelLoginView(): VercelLoginView {
  return store.run?.view ?? IDLE;
}

/**
 * `  Visit vercel.com/oauth/device?user_code=ABCD-1234`, or the URL alone.
 *
 * The CLI prints the link as its *text* without the scheme when it cannot make a
 * terminal hyperlink, so the match is the host and path and the scheme is added
 * — what the console hands back is something to click.
 */
const DEVICE_URL = /(?:https?:\/\/)?(vercel\.com\/oauth\/device\?[^\s"'`]+)/i;

function emit(run: LoginRun, event: VercelLoginEvent): void {
  for (const listener of run.listeners) {
    try {
      listener(event);
    } catch {
      // A closed stream. The route removes it.
    }
  }
}

function emitView(run: LoginRun): void {
  emit(run, { type: "login", login: run.view, at: Date.now() });
}

/**
 * Which stream a line belongs on, once it has been read.
 *
 * The `vercel` CLI writes **everything** to stderr — the device URL, the
 * "Waiting for authentication…" spinner, the failures — so the stream a line
 * arrived on says nothing about what it is, and a transcript that coloured all
 * of it red would paint the one line the person needs as an error. What is left
 * is the line's own words.
 */
function classify(text: string): LogLine["stream"] {
  if (/^\s*Error:/i.test(text)) return "err";
  if (/^\s*(?:❌|✖|🛑)/.test(text)) return "err";
  return "out";
}

function appendLine(run: LoginRun, stream: LogLine["stream"], text: string): void {
  run.seq += 1;
  const line: LogLine = { seq: run.seq, at: Date.now(), stream, text };
  run.lines.push(line);
  if (run.lines.length > MAX_LINES) run.lines.splice(0, run.lines.length - MAX_LINES);
  run.view.lineCount = run.lines.length;

  const device = DEVICE_URL.exec(text);
  if (device && !run.view.url) {
    run.view.url = `https://${device[1]}`;
    emitView(run);
    // The CLI prints this exactly once per attempt, so this fires exactly once:
    // one sign-in, one window.
    void openDevicePage(run, run.view.url);
  }

  emit(run, { type: "log", line });
}

/* ------------------------------------------------------------------ *
 * Reading, from a page
 * ------------------------------------------------------------------ */

/** Everything a subscriber joining now has missed, in order. */
export function vercelLoginBacklog(): VercelLoginEvent[] {
  const run = store.run;
  if (!run) return [{ type: "login", login: IDLE, at: Date.now() }];

  const events: VercelLoginEvent[] = [
    { type: "login", login: run.view, at: Date.now() },
  ];
  for (const line of run.lines) events.push({ type: "log", line });
  return events;
}

export function subscribeVercelLogin(
  listener: (event: VercelLoginEvent) => void,
): () => void {
  const run = store.run;
  if (!run) return () => {};
  run.listeners.add(listener);
  return () => {
    run.listeners.delete(listener);
  };
}

/* ------------------------------------------------------------------ *
 * Running it
 * ------------------------------------------------------------------ */

export function startVercelLogin(): VercelLoginView {
  if (store.run?.view.status === "running") return store.run.view;

  const run: LoginRun = {
    view: {
      status: "running",
      step: vercelCliPath() ? "login" : "install",
      startedAt: Date.now(),
      finishedAt: null,
      url: null,
      error: null,
      lineCount: 0,
    },
    lines: [],
    listeners: new Set(),
    child: null,
    cancelled: false,
    seq: 0,
  };

  installCleanup();
  store.run = run;
  void execute(run);
  return run.view;
}

export function cancelVercelLogin(): VercelLoginView {
  const run = store.run;
  if (!run || run.view.status !== "running") return vercelLoginView();

  run.cancelled = true;
  kill(run);
  appendLine(run, "note", "cancelled");
  finish(run, null);
  return run.view;
}

function setStep(run: LoginRun, step: VercelLoginStep): void {
  run.view.step = step;
  emitView(run);
}

function finish(run: LoginRun, failure: string | null): void {
  const view = run.view;
  view.finishedAt = Date.now();
  view.step = null;
  view.error = failure;
  view.status = run.cancelled ? "cancelled" : failure ? "failed" : "done";
  emit(run, { type: "end", login: view, at: Date.now() });
}

/**
 * One command of the flow, with its output streamed and its handle kept.
 *
 * `detached` for the same reason the dev servers are: `pnpm i -g` runs a package
 * manager underneath itself, and a cancel that killed only the process the
 * console holds would leave the rest of it writing to the pnpm store. `cwd` is
 * the home directory rather than the repository — a login belongs to the
 * machine, not to a project, and running it inside the checkout invites the CLI
 * to read whatever `vercel.json` it finds.
 */
async function command(
  run: LoginRun,
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const result = await runCommand(binary, args, {
    cwd: os.homedir(),
    env: cliEnv(),
    detached: true,
    timeoutMs,
    onSpawn: (child) => {
      run.child = child;
    },
    onLine: (stream, text) => appendLine(run, stream === "err" ? classify(text) : stream, text),
  });

  run.child = null;
  return { code: result.code, signal: result.signal };
}

/** `pnpm i -g vercel`, or npm when there is no pnpm to ask. */
async function installCli(run: LoginRun): Promise<string> {
  const manager = whichTool("pnpm") ? "pnpm" : "npm";
  appendLine(
    run,
    "note",
    `the Vercel CLI is not on PATH — installing it with \`${manager} i -g vercel\``,
  );

  const result = await command(run, manager, ["i", "-g", "vercel"], INSTALL_TIMEOUT_MS);
  if (result.code !== 0) {
    throw new Error(
      `\`${manager} i -g vercel\` exited with ${result.code ?? result.signal}. ` +
        (manager === "pnpm"
          ? "A global install needs a writable global bin — `pnpm setup` creates one."
          : "A global install needs a writable global bin directory."),
    );
  }

  const installed = vercelCliPath();
  if (!installed) {
    throw new Error(
      "The CLI installed but is not on this process's PATH. Run `pnpm setup` (or add pnpm's " +
        "global bin to PATH) and start the console again.",
    );
  }
  return installed;
}

function whichTool(name: string): boolean {
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), process.env.PNPM_HOME ?? ""];
  return dirs.some((dir) => {
    if (!dir) return false;
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function execute(run: LoginRun): Promise<void> {
  try {
    const binary = vercelCliPath() ?? (await installCli(run));

    setStep(run, "login");

    const local = Object.keys(cliStoreEnv()).length > 0;
    if (local) {
      // Said before the login runs, because it explains both why this console
      // needed a store of its own and why `vercel whoami` in a terminal may
      // disagree with this page afterwards.
      appendLine(
        run,
        "note",
        "this console cannot write the CLI's usual store — the session is being kept in " +
          "apps/play/.vercel-cli, which a terminal's `vercel` will not see",
      );
    }

    appendLine(
      run,
      "note",
      "running `vercel login` — a browser window is opening for you to approve the code",
    );

    const result = await command(run, binary, ["login"], LOGIN_TIMEOUT_MS);
    if (run.cancelled) return;
    if (result.code !== 0) {
      throw new Error(
        `\`vercel login\` exited with ${result.code ?? result.signal}.` +
          (result.code === null ? " It was stopped before authentication finished." : ""),
      );
    }

    const session = cliToken();
    if (!session) {
      throw new Error(
        "The login finished but the CLI's store has no token — run `vercel whoami` in a " +
          "terminal to see what it makes of the session.",
      );
    }

    appendLine(run, "note", `signed in — the CLI's session is now the console's token`);
    finish(run, null);
  } catch (error) {
    if (run.cancelled) return;
    appendLine(run, "err", message(error));
    finish(run, message(error));
  }
}

/* ------------------------------------------------------------------ *
 * Leaving
 * ------------------------------------------------------------------ */

function kill(run: LoginRun): void {
  const pid = run.child?.pid;
  if (!pid) return;
  try {
    // Detached, so the negative pid reaches the package manager's own children.
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/**
 * A sign-in does not outlive the console that started it.
 *
 * Nobody is waiting on a device code that no page will ever show, and the
 * process would otherwise sit there polling Vercel until its code expires.
 */
function installCleanup(): void {
  if (store.cleanupInstalled) return;
  store.cleanupInstalled = true;

  const cleanup = () => {
    const run = store.run;
    // Only this process's own child: the store is not the same thing as
    // ownership, for the reason `server/services.ts` sets out at length.
    if (run?.child) kill(run);
  };

  process.on("exit", cleanup);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
}
