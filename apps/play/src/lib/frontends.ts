import type { Tone } from "@/components/ui/chip";
import type { AppKey, ServiceStatus } from "@/lib/types";

/**
 * The three frontends, named once.
 *
 * Not a second source of truth about the apps — `APPS` in `server/repo.ts` is
 * what starts them and what says which port each one binds. This is the half a
 * *page* needs before the stream has said anything: the list is drawn from here
 * so all three exist on screen from the first paint, and a URL can name one of
 * them before a request has been made. Everything that is a fact about a running
 * process — its port, its blurb, its state — still comes from the server.
 */
export interface FrontendChoice {
  value: AppKey;
  label: string;
  /** The one line a dropdown shows beside the name. */
  hint: string;
}

export const FRONTENDS: readonly FrontendChoice[] = [
  { value: "studio", label: "Studio", hint: ":3000 · authoring" },
  { value: "marketplace", label: "Marketplace", hint: ":3001 · public" },
  { value: "demo", label: "Demo", hint: ":4000 · third-party client" },
];

/** The one in a URL, or nothing — which a page turns into a 404. */
export function frontendOf(slug: string): FrontendChoice | undefined {
  return FRONTENDS.find((frontend) => frontend.value === slug);
}

/**
 * The words the console uses for a dev server, and the tone each one carries.
 *
 * `stopped` is the one that is not a verdict: a frontend nobody started is the
 * normal state of a frontend, not a failure.
 */
export const STATUS: Record<ServiceStatus, { tone: Tone; label: string }> = {
  stopped: { tone: "muted", label: "stopped" },
  starting: { tone: "run", label: "starting" },
  running: { tone: "ok", label: "running" },
  failed: { tone: "bad", label: "failed" },
};

/** A dev server that is up, or on its way — the two states that are "live". */
export function isLive(status: ServiceStatus): boolean {
  return status === "running" || status === "starting";
}
