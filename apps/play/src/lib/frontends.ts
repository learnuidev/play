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
 * The apps that are deployed, and what each one is called on Vercel.
 *
 * One list, read by both halves of the console: the server's Vercel integration
 * uses it to find the project and to name the ref it builds, and the browser's
 * deploy form uses it to suggest a domain. Two copies would be two answers to
 * "which project is this app", and the failure mode of that is a deploy writing
 * `staging`'s API URL into the production project.
 *
 * [docs/deploy.md](../../../docs/deploy.md) is the contract and the walk-through;
 * this is the console's one transcription of it. The demo is absent on purpose —
 * it is a third-party OAuth client of the same API rather than a product surface,
 * so it has no project and is deployed nowhere.
 */
export const VERCEL_APPS = [
  {
    app: "studio" as const,
    name: "play-studio",
    rootDirectory: "apps/studio",
    /** The domain the project is expected to serve. */
    domain: "studio.lets-play.xyz",
  },
  {
    app: "marketplace" as const,
    name: "play-marketplace",
    rootDirectory: "apps/marketplace",
    domain: "lets-play.xyz",
  },
] as const;

export type VercelApp = (typeof VERCEL_APPS)[number];

/** The project name and domain of a deployed app, or undefined for the demo. */
export function vercelAppOf(app: AppKey): VercelApp | undefined {
  return VERCEL_APPS.find((candidate) => candidate.app === app);
}

/**
 * The domain a stage's deploy would put an app on, as a *default* for the form.
 *
 * A suggestion rather than a fact: it is prefilled into an editable field because
 * `staging.studio.lets-play.xyz` is the obvious name for staging's studio and
 * retyping it every time is how it ends up misspelt. `dev` is where the bare
 * domains belong; every other stage gets a subdomain of its own. What is actually
 * attached is read back from Vercel, never from this rule.
 */
export function suggestDomain(app: AppKey, stage: string): string {
  const deployed = vercelAppOf(app);
  if (!deployed) return "";
  return stage === "production"
    ? deployed.domain
    : `${stage}.${deployed.domain}`;
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
