import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { AppKey, LogLine, ServiceEvent, ServiceView } from "@/lib/types";
import { stageOutputs } from "./environments";
import { stripAnsi } from "./exec";
import {
  APPS,
  appDefinition,
  appDir,
  defaultRegion,
  nextBin,
  profileSetting,
  repoRoot,
} from "./repo";

/**
 * The three frontends, started from here.
 *
 * ## What "with a specific environment" means
 *
 * A Next app reads `NEXT_PUBLIC_*` from its `.env.local` **and** from the
 * environment it is started in — and the environment wins. `@next/env` fills in
 * only the keys `process.env` does not already have, which is the documented
 * behaviour and the property this whole feature rests on: the console can start
 * the studio against `staging` without touching `apps/studio/.env.local`, and
 * the file the developer has been editing keeps saying what it said.
 *
 * The values come from the same two stacks `get-env` reads, so a stage is
 * *started* the same way it is *written down*.
 *
 * ## Why the process is detached
 *
 * `next dev` spawns a server, a compiler worker and — once a page with a
 * browser bundle is requested — more. Killing the process the console holds
 * would leave the rest of that tree holding the port, and the next start would
 * fail with `EADDRINUSE` for no reason anybody could see. Detached puts the tree
 * in its own process group, so one `kill(-pid)` takes all of it. The price is
 * that the console is responsible for cleaning up, which is what the exit
 * handlers at the bottom are for.
 */

const MAX_LINES = 400;

/**
 * What this console has running, written down.
 *
 * A dev server is detached, so it outlives the process that started it — which
 * is the property that lets it keep its port and its compiler workers, and the
 * reason a console that was killed with `SIGKILL`, rebuilt, or simply restarted
 * would otherwise come back having forgotten three processes it is still
 * responsible for. The file is what makes "the console knows what it started" a
 * fact about the machine rather than about one Node process.
 *
 * It lives in the OS temporary directory, keyed by the repository, because it
 * describes processes on *this* machine: it is not configuration, it must not
 * be committed, and a clone in another directory is a different set of them.
 */
const STATE_FILE = path.join(
  os.tmpdir(),
  `play-console-${createHash("sha1").update(repoRoot()).digest("hex").slice(0, 8)}.json`,
);

interface Service {
  view: ServiceView;
  lines: LogLine[];
  listeners: Set<(event: ServiceEvent) => void>;
  child: ChildProcess | null;
  /** Set once the dev server has printed its URL, so a later exit reads as a crash. */
  ready: boolean;
  seq: number;
}

interface Store {
  services: Map<AppKey, Service>;
  seq: number;
  /** On the store rather than in a module, so a hot reload cannot double up. */
  cleanupInstalled: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __playConsoleServices: Store | undefined;
}

const store: Store = (globalThis.__playConsoleServices ??= {
  services: new Map(),
  seq: 0,
  cleanupInstalled: false,
});

interface Persisted {
  app: AppKey;
  pid: number;
  stage: string | null;
  apiUrl: string | null;
  startedAt: number;
  readyAt: number | null;
}

function writePersisted(): void {
  const entries: Persisted[] = [];
  for (const app of APPS) {
    const view = store.services.get(app.key)?.view;
    // Only a process that is actually somewhere is worth remembering: a row
    // that says "stopped" is the console's business, not the file's.
    if (!view || view.pid === null) continue;
    if (view.status !== "running" && view.status !== "starting") continue;
    entries.push({
      app: view.app,
      pid: view.pid,
      stage: view.stage,
      apiUrl: view.apiUrl,
      startedAt: view.startedAt ?? Date.now(),
      readyAt: view.readyAt,
    });
  }

  try {
    if (entries.length === 0) fs.rmSync(STATE_FILE, { force: true });
    else fs.writeFileSync(STATE_FILE, `${JSON.stringify(entries, null, 2)}\n`);
  } catch {
    // A console that cannot write its own scratch file still works; it just
    // forgets across restarts, which is where it started.
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Picks up processes an earlier console left running.
 *
 * Adopted, not restarted: the dev server is fine, it is the *console* that went
 * away. What cannot be recovered is its output — the pipes died with the process
 * that held them — so the card says so and offers the one thing that still
 * works, which is stopping it.
 */
function reattach(): void {
  if (!fs.existsSync(STATE_FILE)) return;

  let entries: Persisted[];
  try {
    entries = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Persisted[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry?.pid || !alive(entry.pid)) continue;
    const service = serviceOf(entry.app);
    service.view = {
      ...service.view,
      status: "running",
      pid: entry.pid,
      stage: entry.stage,
      apiUrl: entry.apiUrl,
      startedAt: entry.startedAt,
      readyAt: entry.readyAt,
      error: null,
      adopted: true,
    };
    appendLine(
      service,
      "note",
      `adopted from an earlier console session (pid ${entry.pid}) — its output is no longer captured`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

function emptyService(app: AppKey): Service {
  const definition = appDefinition(app)!;
  return {
    view: {
      app,
      name: definition.name,
      blurb: definition.blurb,
      port: definition.port,
      url: `http://localhost:${definition.port}`,
      stage: null,
      status: "stopped",
      pid: null,
      startedAt: null,
      readyAt: null,
      exitCode: null,
      error: null,
      apiUrl: null,
      lineCount: 0,
      adopted: false,
    },
    lines: [],
    listeners: new Set(),
    child: null,
    ready: false,
    seq: 0,
  };
}

function serviceOf(app: AppKey): Service {
  let found = store.services.get(app);
  if (!found) {
    found = emptyService(app);
    store.services.set(app, found);
  }
  return found;
}

export function listServices(): ServiceView[] {
  return APPS.map((app) => serviceOf(app.key).view);
}

/**
 * One listener on all three services, and the backlog to go with it.
 *
 * The three cards share a stream because they share a page: a subscriber that
 * had to open one EventSource per card would be three connections to say one
 * thing, and a card that appeared later would miss what was said before it.
 */
export function subscribeServices(
  listener: (event: ServiceEvent) => void,
): () => void {
  for (const app of APPS) serviceOf(app.key).listeners.add(listener);
  return () => {
    for (const app of APPS) serviceOf(app.key).listeners.delete(listener);
  };
}

export function servicesBacklog(): ServiceEvent[] {
  const events: ServiceEvent[] = [
    { type: "services", services: listServices(), at: Date.now() },
  ];
  for (const app of APPS) {
    const service = serviceOf(app.key);
    for (const line of service.lines) {
      events.push({ type: "log", app: app.key, line });
    }
  }
  return events;
}

function emit(service: Service, event: ServiceEvent): void {
  for (const listener of service.listeners) {
    try {
      listener(event);
    } catch {
      // A closed stream. The server removes it.
    }
  }
}

function emitService(service: Service): void {
  writePersisted();
  emit(service, { type: "status", service: service.view, at: Date.now() });
}

function appendLine(service: Service, stream: LogLine["stream"], text: string): void {
  store.seq += 1;
  const line: LogLine = { seq: store.seq, at: Date.now(), stream, text };
  service.lines.push(line);
  if (service.lines.length > MAX_LINES) {
    service.lines.splice(0, service.lines.length - MAX_LINES);
  }
  service.view.lineCount = service.lines.length;
  emit(service, { type: "log", app: service.view.app, line });
}

/* ------------------------------------------------------------------ *
 * Starting
 * ------------------------------------------------------------------ */

export interface StartServiceOptions {
  app: AppKey;
  /** `null` runs the app against whatever its own `.env.local` says. */
  stage: string | null;
  profile?: string;
  region?: string;
}

export async function startService(options: StartServiceOptions): Promise<ServiceView> {
  const { app, stage } = options;
  const service = serviceOf(app);
  const definition = appDefinition(app)!;

  if (service.view.status === "running" || service.view.status === "starting") {
    return service.view;
  }

  const profile = options.profile ?? profileSetting().profile;
  const region = options.region ?? defaultRegion();

  let overrides: Record<string, string> = {};
  let apiUrl: string | null = null;

  if (stage) {
    const outputs = await stageOutputs(stage, { profile, region });
    if (!outputs.apiUrl) {
      throw new Error(
        `Play${stage}: the API stack has no ApiUrl output, so there is nothing to point ${definition.name} at. ` +
          "Deploy that environment first.",
      );
    }
    overrides = { ...outputs.env };
    apiUrl = outputs.apiUrl;

    if (app === "demo") {
      // The demo is a third-party client: it signs in through the studio's
      // consent screen, so it needs to know where the studio is, and the
      // studio's port is the app's, not the deployment's.
      overrides.NEXT_PUBLIC_PLAY_STUDIO_URL = "http://localhost:3000";
    }
  }

  service.lines = [];
  service.seq = 0;
  service.ready = false;
  service.view = {
    ...service.view,
    status: "starting",
    stage,
    pid: null,
    startedAt: Date.now(),
    readyAt: null,
    exitCode: null,
    error: null,
    apiUrl,
    lineCount: 0,
    adopted: false,
  };
  emitService(service);

  appendLine(
    service,
    "note",
    stage
      ? `starting ${definition.name} against '${stage}'${apiUrl ? ` — ${apiUrl}` : ""}`
      : `starting ${definition.name} against its own .env.local`,
  );

  const args = ["dev", "-p", String(definition.port)];
  const command = nextBin();

  const child = spawn(process.execPath, [command, ...args], {
    cwd: appDir(app),
    env: {
      ...process.env,
      // Above `.env.local` on purpose — see the note at the top of this file.
      ...overrides,
      // `next dev` is happy to open a browser; a console that steals focus every
      // time a card is clicked is not a console anybody keeps open.
      BROWSER: "none",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  service.child = child;
  service.view.pid = child.pid ?? null;
  emitService(service);

  const pending = { out: "", err: "" };

  function consume(stream: "out" | "err", chunk: string) {
    pending[stream] += chunk;
    const parts = pending[stream].split("\n");
    pending[stream] = parts.pop() ?? "";
    for (const part of parts) {
      const carriage = part.lastIndexOf("\r");
      const text = stripAnsi(carriage === -1 ? part : part.slice(carriage + 1)).replace(/\s+$/, "");
      appendLine(service, stream === "out" ? "out" : "err", text);

      // `✓ Ready in 2.1s` and `- Local: http://localhost:3000` are the two lines
      // Next prints when it is actually serving. The URL is the better signal:
      // it is printed after the port is bound.
      if (!service.ready && /Local:\s+http:\/\/localhost:\d+/.test(text)) {
        service.ready = true;
        service.view.status = "running";
        service.view.readyAt = Date.now();
        emitService(service);
      }
    }
  }

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => consume("out", chunk));
  child.stderr?.on("data", (chunk: string) => consume("err", chunk));

  child.on("error", (error) => {
    service.view.status = "failed";
    service.view.error = error.message;
    appendLine(service, "err", error.message);
    emitService(service);
  });

  child.on("close", (code) => {
    const wasReady = service.ready;
    service.child = null;
    service.ready = false;
    service.view.pid = null;
    service.view.exitCode = code;
    service.view.status = code === 0 || code === null ? "stopped" : "failed";
    if (service.view.status === "failed" && !service.view.error) {
      service.view.error = wasReady
        ? `the dev server exited with code ${code}`
        : `the dev server exited with code ${code} before it was serving`;
    }
    appendLine(service, "note", `stopped (exit ${code ?? "signal"})`);
    emitService(service);
  });

  return service.view;
}

/* ------------------------------------------------------------------ *
 * Stopping
 * ------------------------------------------------------------------ */

export function stopService(app: AppKey): ServiceView {
  const service = serviceOf(app);
  killService(service, "SIGTERM");

  if (!service.child) {
    // An adopted service has no `close` event coming: the pipe that would have
    // carried it died with the console that opened it. Saying it is stopped is
    // the honest answer — and if the process somehow survived, the card's port
    // check says so on the next read.
    service.view = {
      ...service.view,
      status: "stopped",
      pid: null,
      readyAt: null,
      error: null,
      adopted: false,
    };
    emitService(service);
  }

  return service.view;
}

function killService(service: Service, signal: NodeJS.Signals): void {
  // The view's pid, not the child's: a service adopted from an earlier console
  // session has no child here and is still ours to stop.
  const pid = service.child?.pid ?? service.view.pid;
  if (!pid) return;
  try {
    // Detached, so the child leads its own group and the negative pid reaches
    // every process `next dev` started underneath it.
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

/* ------------------------------------------------------------------ *
 * Is the port already taken?
 * ------------------------------------------------------------------ */

/**
 * Whether something is listening on an app's port.
 *
 * Asked by **connecting**, not by trying to bind — and that is not a detail.
 * `next dev` binds the wildcard address, and on macOS a listener on `*:3000` and
 * a test bind of `127.0.0.1:3000` do not collide: the bind succeeds, the console
 * reports the port free, and the dev server it starts dies with `EADDRINUSE`
 * four lines of stack trace later. A connect answers the question that actually
 * matters — is somebody serving here — and answers it the same way the browser
 * will.
 *
 * Both stacks are tried, because a listener on one is invisible to the other
 * and the address `localhost` resolves to is not ours to decide.
 */
function isListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

export async function portInUse(port: number): Promise<boolean> {
  const [v4, v6] = await Promise.all([
    isListening("127.0.0.1", port),
    isListening("::1", port),
  ]);
  return v4 || v6;
}

export async function occupiedPorts(): Promise<number[]> {
  const results = await Promise.all(
    APPS.map(async (app) => ((await portInUse(app.port)) ? app.port : null)),
  );
  return results.filter((port): port is number => port !== null);
}

/* ------------------------------------------------------------------ *
 * Leaving
 * ------------------------------------------------------------------ */

/**
 * The console does not outlive its children.
 *
 * A dev server whose parent died is a process nobody can name, holding a port
 * nobody can free and running against an environment nobody chose. These
 * handlers are the whole of the cleanup: `exit` is synchronous, which `kill` is,
 * so the last thing the console does is take its children with it.
 */
export function installCleanup(): void {
  if (store.cleanupInstalled) return;
  store.cleanupInstalled = true;

  const cleanup = () => {
    for (const app of APPS) {
      const service = store.services.get(app.key);
      if (service) killService(service, "SIGKILL");
    }
  };

  process.on("exit", cleanup);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
}

// Whichever route is reached first installs the handlers and adopts whatever an
// earlier console session left running — which is the earliest moment either can
// matter.
installCleanup();
reattach();
