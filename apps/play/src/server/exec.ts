import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import type { LogLine, LogStream } from "@/lib/types";

/**
 * Running a command and watching it, line by line.
 *
 * Everything the console does is a process: `aws`, `cdk`, `node`, `next dev`.
 * What makes this more than `execFile` is that a transcript is the point —
 * `cdk deploy` on a hundred and thirty-four functions takes minutes, and the
 * minute it spends creating a stack is the minute somebody wants to watch. So
 * the output is split into lines as it arrives and handed to a callback, and the
 * whole of it is also kept, because a step that fails is read afterwards.
 *
 * Two details are load-bearing:
 *
 * - **A line is not a line until the newline.** `cdk`'s progress bar and
 *   esbuild's both write `\r` to redraw, so a chunk has to be split on `\r` as
 *   well as `\n` or the transcript fills with a bar that redraws forever.
 * - **stdin is `ignore`.** Every prompt these tools can raise — a CDK approval,
 *   an SSO login, a `y/n` — would otherwise hang a run that nobody is standing
 *   at, and a run that hangs is worse than a run that fails.
 */

/** SGR, OSC and the other escape sequences a terminal colouriser emits. */
// eslint-disable-next-line no-control-regex
const ANSI = /[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-Za-z@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * A child with both pipes and no stdin.
 *
 * Named rather than spelled out at each use because `stdio: ["ignore", "pipe",
 * "pipe"]` narrows the type to this one — stdin is `null`, not a stream — and
 * `ChildProcessWithoutNullStreams` is the wrong shape for it.
 */
export type PipedChild = ChildProcessByStdio<null, Readable, Readable>;

export interface RunOptions {
  cwd?: string;
  /** Merged over `process.env`. `undefined` removes a variable. */
  env?: Record<string, string | undefined>;
  onLine?: (stream: LogStream, text: string) => void;
  /** Milliseconds before the process is killed and the step fails. */
  timeoutMs?: number;
  /** Called once with the live child, so a caller can keep a handle to kill. */
  onSpawn?: (child: PipedChild) => void;
  /**
   * Put the child in a process group of its own.
   *
   * On for anything that spawns: `cdk` is a Node process that starts `ts-node`
   * for the app, which starts esbuild, and killing the process this console
   * holds would leave the rest of that tree running against a stack nobody is
   * watching any more. Detached lets one `kill(-pid)` reach all of it — and it
   * is why anything using it has to clean up on the way out.
   */
  detached?: boolean;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The command as it would be typed, for a transcript header. */
  command: string;
}

function buildEnv(overrides: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  // Spread rather than a copy loop: `ProcessEnv` is module-augmented by Next to
  // require `NODE_ENV`, so an empty object literal is not one.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  // Not a terminal, and both `cdk` and `next` change their output when they
  // think one is attached — colours we would have to strip, and a spinner that
  // would arrive as a redraw every frame.
  env.FORCE_COLOR = "0";
  env.NO_COLOR = "1";
  env.CI = "1";
  return env;
}

export function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const { cwd, env: envOverrides, onLine, timeoutMs, onSpawn, detached } = options;

  return new Promise<RunResult>((resolve, reject) => {
    let child: PipedChild;
    try {
      child = spawn(command, args, {
        cwd,
        env: buildEnv(envOverrides),
        stdio: ["ignore", "pipe", "pipe"],
        detached: detached ?? false,
      });
    } catch (error) {
      reject(error);
      return;
    }

    onSpawn?.(child);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs)
        : null;

    /** Buffers, because a chunk boundary is not a line boundary. */
    const pending: Record<"out" | "err", string> = { out: "", err: "" };

    function emit(stream: LogStream, text: string) {
      if (!onLine) return;
      // An empty line is a paragraph break in a transcript, and dropping them
      // runs every multi-line message into one block.
      onLine(stream, stripAnsi(text).replace(/\s+$/, ""));
    }

    function consume(stream: "out" | "err", chunk: string) {
      pending[stream] += chunk;
      const parts = pending[stream].split("\n");
      // The last part has no newline yet: it is the start of the next line.
      pending[stream] = parts.pop() ?? "";
      for (const part of parts) {
        // A line may still carry a redraw: keep only what was written last.
        const carriage = part.lastIndexOf("\r");
        emit(stream === "out" ? "out" : "err", carriage === -1 ? part : part.slice(carriage + 1));
      }
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      consume("out", chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      consume("err", chunk);
    });

    function finish(code: number | null, signal: NodeJS.Signals | null) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      for (const stream of ["out", "err"] as const) {
        if (pending[stream]) {
          emit(stream === "out" ? "out" : "err", pending[stream]);
          pending[stream] = "";
        }
      }
      resolve({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        command: [command, ...args].join(" "),
      });
    }

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on("close", finish);
  });
}

/**
 * One shell-quoted command, for a transcript that shows what was run.
 *
 * Display only — nothing here is evaluated by a shell. Spawning is `execFile`
 * semantics with an argument vector, which is why no value from a request ever
 * reaches a command line as syntax.
 */
export function display(command: string, args: string[]): string {
  const quote = (value: string) =>
    /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
  return [command, ...args].map(quote).join(" ");
}

/** The tail of a captured output, for a failure note. */
export function lastMeaningfulLines(text: string, count = 6): string[] {
  return stripAnsi(text)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-count);
}
