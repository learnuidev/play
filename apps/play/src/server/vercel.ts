import fs from "node:fs";
import path from "node:path";

import type {
  VercelDeploymentView,
  VercelEnvVar,
  VercelOverview,
  VercelProjectView,
  VercelTokenSource,
} from "@/lib/types";
import { repoPath } from "./repo";
import { cliToken, lapsed, vercelCliView, vercelLoginView } from "./vercel-cli";

/**
 * Vercel, read-only.
 *
 * The two frontends are deployed to Vercel as two projects built from this
 * repository — `docs/deploy.md` is the document, and it is not a hypothetical:
 * `play-studio` builds `apps/studio`, `play-marketplace` builds
 * `apps/marketplace`, and neither is deployed from here.
 *
 * **This console never writes to Vercel.** It reads three things and stops:
 * which projects exist, what they last deployed, and — the one that actually
 * explains bugs — what `NEXT_PUBLIC_*` values they were built with.
 *
 * That third one is the point. `NEXT_PUBLIC_*` is inlined by Next at build time,
 * so a deployed frontend talks to whichever API URL was set on the project when
 * it was built. Change the environment variable and nothing happens until a
 * redeploy; set the wrong one and the deployed app is pointed at `dev` while
 * every local file says `staging`. That mismatch is invisible from both ends
 * until somebody reads it off the project, which is what this does.
 */

const API = "https://api.vercel.com";

/** Where a token given through the UI is kept. Gitignored, like every `.env.local`. */
function tokenFile(): string {
  return repoPath("apps", "play", ".env.local");
}

/**
 * The token, from the three places this machine can keep one.
 *
 * `VERCEL_TOKEN` in the shell first, so a one-off `VERCEL_TOKEN=… npm run play`
 * does not overwrite what is stored. Then **the CLI's session**, because that is
 * what the page's Connect button creates and what `vercel whoami` reports — a
 * token that a person can inspect with their own tool outranks one typed into a
 * form once and forgotten. Then the file the form writes.
 *
 * The trade-off is worth naming: while the CLI is signed in, a token saved in
 * `apps/play/.env.local` is not what the console uses. The page says which
 * source is in play for exactly that reason, and `vercel logout` — in a
 * terminal, where the CLI's session belongs — hands the file its turn back.
 */
export function vercelToken(): {
  token: string | null;
  source: VercelTokenSource | null;
  expiresAt: number | null;
} {
  const fromEnv = process.env.VERCEL_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "environment", expiresAt: null };

  // A CLI session that has lapsed is not a token anything can use, and renewing
  // it is the CLI's business in the CLI's own process — so it steps aside for
  // whatever else this machine has, and `cli.tokenExpiresAt` carries the reason
  // to the page that reports it.
  const fromCli = cliToken();
  if (fromCli && !lapsed(fromCli.expiresAt)) {
    return { token: fromCli.token, source: "cli", expiresAt: fromCli.expiresAt };
  }

  try {
    const text = fs.readFileSync(tokenFile(), "utf8");
    const line = text.split("\n").find((candidate) => candidate.startsWith("VERCEL_TOKEN="));
    const value = line?.slice("VERCEL_TOKEN=".length).trim();
    if (value) return { token: value, source: "file", expiresAt: null };
  } catch {
    // No file, no token.
  }

  return { token: null, source: null, expiresAt: null };
}

/**
 * Store a token, or clear it.
 *
 * The file is read and the one line replaced rather than rewritten, so anything
 * else in it survives — the same rule the rest of the console follows for files
 * it does not own.
 */
export function saveVercelToken(token: string | null): void {
  const file = tokenFile();
  let lines: string[] = [];

  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch {
    lines = [];
  }

  const kept = lines.filter(
    (line) => line.trim() && !line.startsWith("VERCEL_TOKEN=") && !line.startsWith("# vercel"),
  );

  if (token) {
    kept.push("", "# Vercel, for the Integrations view. Read-only — the console never deploys.", `VERCEL_TOKEN=${token}`);
  }

  fs.writeFileSync(file, kept.length ? `${kept.join("\n")}\n` : "");
}

/** A Vercel API call, with the CLI's own shape of failure. */
async function call<T>(
  token: string,
  route: string,
  options: { teamId?: string } = {},
): Promise<T> {
  const url = new URL(`${API}${route}`);
  if (options.teamId) url.searchParams.set("teamId", options.teamId);

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    const detail = body?.error?.message ?? `${response.status} ${response.statusText}`;
    if (response.status === 403) {
      throw new Error(`Vercel refused the token: ${detail}`);
    }
    throw new Error(`Vercel: ${detail}`);
  }

  return (await response.json()) as T;
}

/** The two projects this repository builds, and what `docs/deploy.md` names them. */
export const VERCEL_PROJECTS = [
  { app: "studio" as const, name: "play-studio", rootDirectory: "apps/studio", domain: "studio.lets-play.xyz" },
  { app: "marketplace" as const, name: "play-marketplace", rootDirectory: "apps/marketplace", domain: "lets-play.xyz" },
];

interface RawProject {
  id: string;
  name: string;
  framework?: string | null;
  rootDirectory?: string | null;
  targets?: { production?: { url?: string | null; alias?: string[] } };
  latestDeployments?: RawDeployment[];
}

interface RawDeployment {
  uid?: string;
  url?: string | null;
  state?: string;
  created?: number;
  target?: string | null;
  readyState?: string;
  meta?: { githubCommitRef?: string; githubCommitMessage?: string; githubCommitSha?: string };
}

interface RawEnv {
  key: string;
  value?: string;
  target?: string[] | string;
  type?: string;
}

const state = (deployment: RawDeployment): string =>
  (deployment.readyState ?? deployment.state ?? "UNKNOWN").toUpperCase();

function toDeployment(raw: RawDeployment): VercelDeploymentView {
  return {
    id: raw.uid ?? "",
    url: raw.url ? `https://${raw.url}` : null,
    state: state(raw),
    target: raw.target ?? null,
    createdAt: raw.created ?? null,
    branch: raw.meta?.githubCommitRef ?? null,
    commitMessage: raw.meta?.githubCommitMessage?.split("\n")[0] ?? null,
    commitSha: raw.meta?.githubCommitSha?.slice(0, 7) ?? null,
  };
}

function toEnvVars(raw: RawEnv[]): VercelEnvVar[] {
  return raw
    .filter((entry) => entry.key.startsWith("NEXT_PUBLIC_"))
    .map((entry) => ({
      key: entry.key,
      // A "sensitive" variable comes back without a value, which is itself worth
      // showing rather than rendering an empty cell.
      value: entry.type === "sensitive" || entry.value === undefined ? null : entry.value,
      targets: Array.isArray(entry.target) ? entry.target : entry.target ? [entry.target] : [],
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Everything the Integrations → Vercel view draws.
 *
 * The project list is read once and matched against the two names this
 * repository builds, rather than searched for: `docs/deploy.md` says the names
 * are whatever you like, so a project that is *not* found is reported as such
 * instead of being guessed at.
 *
 * A token that Vercel refuses is reported, not retried. The one source with a
 * refresh token behind it is the CLI's session, and that renewal is the CLI's to
 * make in its own process — a console that drove it would be writing to a store
 * it does not own. What the page does instead is say which session was refused
 * and offer the sign-in that replaces it.
 */
export async function vercelOverview(): Promise<VercelOverview> {
  const login = vercelLoginView();
  const session = vercelToken();

  if (!session.token) {
    return {
      connected: false,
      tokenSource: null,
      cli: vercelCliView(),
      login,
      projects: projectsNotFound(),
      error: null,
    };
  }

  try {
    return {
      connected: true,
      tokenSource: session.source,
      cli: vercelCliView(),
      login,
      projects: await readProjects(session.token),
      error: null,
    };
  } catch (error) {
    return {
      connected: true,
      tokenSource: session.source,
      cli: vercelCliView(),
      login,
      projects: projectsNotFound(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The two wanted projects, reported rather than guessed at. */
function projectsNotFound(): VercelProjectView[] {
  return VERCEL_PROJECTS.map((project) => ({
    ...project,
    found: false,
    id: null,
    prodUrl: null,
    deployments: [],
    env: [],
    error: null,
  }));
}

async function readProjects(token: string): Promise<VercelProjectView[]> {
  const [{ projects }, deployments] = await Promise.all([
    call<{ projects: RawProject[] }>(token, "/v9/projects?limit=100"),
    call<{ deployments: RawDeployment[] }>(token, "/v6/deployments?limit=30").catch(() => ({
      deployments: [] as RawDeployment[],
    })),
  ]);

  const byName = new Map(projects.map((project) => [project.name, project]));

  const views: VercelProjectView[] = await Promise.all(
    VERCEL_PROJECTS.map(async (wanted) => {
      const project = byName.get(wanted.name);
      if (!project) {
        return {
          ...wanted,
          found: false,
          id: null,
          prodUrl: null,
          deployments: [],
          env: [],
          error: null,
        };
      }

      // The project's own list when it has one, else the account-wide list
      // filtered by project id — the deployments endpoint takes one or the
      // other, and a project with no deployments is not an error.
      const forProject = deployments.deployments.filter(
        (deployment) => (deployment as RawDeployment & { projectId?: string }).projectId === project.id,
      );
      const recent = (project.latestDeployments?.length ? project.latestDeployments : forProject)
        .slice(0, 6)
        .map(toDeployment);

      const env = await call<{ envs: RawEnv[] }>(token, `/v9/projects/${project.id}/env?decrypt=true`)
        .then((body) => toEnvVars(body.envs ?? []))
        .catch(() => [] as VercelEnvVar[]);

      return {
        ...wanted,
        found: true,
        id: project.id,
        rootDirectory: project.rootDirectory ?? null,
        prodUrl: project.targets?.production?.url
          ? `https://${project.targets.production.url}`
          : (project.targets?.production?.alias?.[0] ?? null),
        deployments: recent,
        env,
        error: null,
      };
    }),
  );

  return views;
}
