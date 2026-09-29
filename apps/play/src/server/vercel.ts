import fs from "node:fs";
import path from "node:path";

import type {
  VercelDeploymentView,
  VercelDomainView,
  VercelEnvVar,
  VercelOverview,
  VercelProjectView,
  VercelRepoView,
  VercelTokenSource,
} from "@/lib/types";
import { VERCEL_APPS } from "@/lib/frontends";
import { repoPath } from "./repo";
import { cliToken, lapsed, vercelCliView, vercelLoginView } from "./vercel-cli";

/**
 * Vercel: the read model, and the one client every call goes through.
 *
 * The two frontends are deployed to Vercel as two projects built from this
 * repository — `docs/deploy.md` is the document, and it is not a hypothetical:
 * `play-studio` builds `apps/studio`, `play-marketplace` builds
 * `apps/marketplace`.
 *
 * **This file reads.** `server/vercel-plan.ts` is where the console *writes* —
 * variables, a domain, a deployment — and it does it through `vercelRequest`
 * here, so that there is one place a token is attached, one place a refusal is
 * turned into a sentence, and one place to look when the question is "what did
 * the console actually send".
 *
 * What the read is for is the one failure that is invisible from both ends:
 * `NEXT_PUBLIC_*` is inlined by Next at build time, so a deployed frontend talks
 * to whichever API URL was set on the project when it was built. Change the
 * environment variable and nothing happens until a redeploy; set the wrong one
 * and the deployed app is pointed at `dev` while every local file says
 * `staging`. That mismatch is invisible from both ends until somebody reads it
 * off the project, which is what this does.
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
  options: { teamId?: string; method?: string; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${API}${route}`);
  if (options.teamId) url.searchParams.set("teamId", options.teamId);

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    const detail = body?.error?.message ?? `${response.status} ${response.statusText}`;
    if (response.status === 403) {
      throw new Error(`Vercel refused the token: ${detail}`);
    }
    throw new Error(`Vercel: ${detail}`);
  }

  // A `DELETE` with an empty body is a success, not a parse error.
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * The one way to Vercel, for the plan as well as for this file.
 *
 * Exported because the write side needs exactly what the read side needed — the
 * token attached once, a refusal turned into a sentence rather than a status
 * code, and no caching between two calls in the same run that must not be
 * collapsed into one.
 */
export async function vercelRequest<T>(
  token: string,
  route: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  return call<T>(token, route, options);
}

/**
 * The token, or the sentence that says why there is none.
 *
 * The three sources are ranked in `vercelToken`, and this does not re-rank them
 * — it only turns "nothing is configured" into something a step can fail with.
 * A step that said `undefined` was refused would be a step nobody can act on.
 */
export function requireVercelToken(): { token: string; source: VercelTokenSource } {
  const session = vercelToken();
  if (!session.token) {
    throw new Error(
      "No Vercel token. Connect the Vercel CLI in Integrations → Vercel, paste a token " +
        "there, or set VERCEL_TOKEN in the shell — the deploy writes to the Vercel account " +
        "that token names, and there is nothing to write with otherwise.",
    );
  }
  return { token: session.token, source: session.source ?? "file" };
}

/**
 * The two projects this repository builds, and what `docs/deploy.md` names them.
 *
 * The list itself lives in `lib/frontends.ts`, because the browser's deploy form
 * needs the same three facts — the project name, the root directory and the
 * domain — and it cannot import a server module to get them. One list, or two
 * answers to "which project is this app".
 */
export const VERCEL_PROJECTS = VERCEL_APPS;

interface RawProject {
  id: string;
  name: string;
  framework?: string | null;
  rootDirectory?: string | null;
  link?: {
    type?: string;
    org?: string;
    repo?: string;
    repoId?: number;
    productionBranch?: string | null;
  } | null;
  targets?: { production?: { url?: string | null; alias?: string[] } };
  latestDeployments?: RawDeployment[];
}

interface RawDeployment {
  /** `uid` on a deployment read, `id` inside a project's `latestDeployments`. */
  uid?: string;
  id?: string;
  url?: string | null;
  state?: string;
  readyState?: string;
  /** `created` on a deployment read, `createdAt` inside `latestDeployments`. */
  created?: number;
  createdAt?: number;
  target?: string | null;
  alias?: string[];
  aliasFinal?: string | null;
  meta?: { githubCommitRef?: string; githubCommitMessage?: string; githubCommitSha?: string };
}

interface RawEnv {
  key: string;
  value?: string;
  target?: string[] | string;
  type?: string;
}

interface RawDomain {
  name?: string;
  verified?: boolean;
  gitBranch?: string | null;
  verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>;
}

const state = (deployment: RawDeployment): string =>
  (deployment.readyState ?? deployment.state ?? "UNKNOWN").toUpperCase();

function toDeployment(raw: RawDeployment): VercelDeploymentView {
  return {
    // The two names are not cosmetic: a project's `latestDeployments` entries
    // carry `id` and `createdAt`, a standalone deployment read carries `uid` and
    // `created`, and reading only one of each pair is how a deployment list ends
    // up with blank ids and "—" in its date column.
    id: raw.uid ?? raw.id ?? "",
    url: raw.url ? `https://${raw.url}` : null,
    state: state(raw),
    target: raw.target ?? null,
    createdAt: raw.created ?? raw.createdAt ?? null,
    branch: raw.meta?.githubCommitRef ?? null,
    commitMessage: raw.meta?.githubCommitMessage?.split("\n")[0] ?? null,
    commitSha: raw.meta?.githubCommitSha?.slice(0, 7) ?? null,
    aliases: [...(raw.alias ?? []), ...(raw.aliasFinal ? [raw.aliasFinal] : [])],
  };
}

/**
 * An environment variable's value, when Vercel will let anybody read it.
 *
 * **An `encrypted` variable's value cannot be read back.** Vercel returns an
 * envelope — base64 of `{"v":"v2","c":…}` — and the `decrypt=true` query that
 * used to open it is deprecated and no longer does. Rendering that would be
 * rendering a credential-shaped blob nobody can use, and comparing it against a
 * value would be comparing two things that are not the same kind of thing, so it
 * is reported as unreadable instead.
 *
 * This is why the console *writes* its variables as `plain`: they are inlined
 * into the JavaScript bundle any visitor downloads, so hiding them hides them
 * from the one person who has to notice that a deployed app is pointed at the
 * wrong backend. See `server/vercel-plan.ts`.
 */
function toEnvVars(raw: RawEnv[]): VercelEnvVar[] {
  return raw
    .filter((entry) => entry.key.startsWith("NEXT_PUBLIC_"))
    .map((entry) => ({
      key: entry.key,
      value: entry.type === "encrypted" || entry.type === "sensitive" ? null : (entry.value ?? null),
      type: entry.type ?? "plain",
      targets: Array.isArray(entry.target) ? entry.target : entry.target ? [entry.target] : [],
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function toDomains(raw: RawDomain[]): VercelDomainView[] {
  return raw
    .filter((domain): domain is RawDomain & { name: string } => Boolean(domain.name))
    .map((domain) => ({
      name: domain.name,
      verified: domain.verified ?? false,
      gitBranch: domain.gitBranch ?? null,
      // What Vercel wants in DNS. Shown rather than derived, because the record
      // is Vercel's to choose and a wrong one is a domain that never resolves.
      records: (domain.verification ?? []).map((challenge) =>
        [challenge.type, challenge.domain, challenge.value]
          .filter(Boolean)
          .join(" ")
          .trim(),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toRepo(project: RawProject): VercelRepoView | null {
  const link = project.link;
  if (!link?.type || !link.repo) return null;
  return {
    type: link.type,
    org: link.org ?? "",
    repo: link.repo,
    repoId: link.repoId ?? null,
    productionBranch: link.productionBranch ?? null,
  };
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
    domains: [],
    repo: null,
    error: null,
  }));
}

/**
 * One project, by the name this repository builds, or null.
 *
 * The deploy plan's first step, and the reason it is a function rather than a
 * field on `vercelOverview`: a run resolves the project *inside* its steps, so
 * that a project renamed between pressing the button and the first call is
 * reported by the step that needed it rather than by a page that read it
 * minutes earlier.
 */
export async function vercelProject(
  name: string,
  ctx: { token?: string } = {},
): Promise<VercelProjectView | null> {
  const token = ctx.token ?? requireVercelToken().token;
  const project = await call<RawProject>(token, `/v9/projects/${encodeURIComponent(name)}`).catch(
    (error: Error) => {
      // `404` is an answer — "no project by that name" — and everything else is
      // a failure to read, which the caller reports with its own words.
      if (/404|not found/i.test(error.message)) return null;
      throw error;
    },
  );
  if (!project) return null;

  const wanted = VERCEL_PROJECTS.find((candidate) => candidate.name === name);
  const domains = await call<{ domains: RawDomain[] }>(
    token,
    `/v9/projects/${project.id}/domains`,
  )
    .then((body) => toDomains(body.domains ?? []))
    .catch(() => [] as VercelDomainView[]);

  return {
    app: wanted?.app ?? "studio",
    name: project.name,
    rootDirectory: project.rootDirectory ?? null,
    domain: wanted?.domain ?? "",
    found: true,
    id: project.id,
    prodUrl: project.targets?.production?.url
      ? `https://${project.targets.production.url}`
      : (project.targets?.production?.alias?.[0] ?? null),
    deployments: (project.latestDeployments ?? []).slice(0, 6).map(toDeployment),
    env: [],
    domains,
    repo: toRepo(project),
    error: null,
  };
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
          domains: [],
          repo: null,
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

      const [env, domains] = await Promise.all([
        call<{ envs: RawEnv[] }>(token, `/v9/projects/${project.id}/env?decrypt=true`)
          .then((body) => toEnvVars(body.envs ?? []))
          .catch(() => [] as VercelEnvVar[]),
        call<{ domains: RawDomain[] }>(token, `/v9/projects/${project.id}/domains`)
          .then((body) => toDomains(body.domains ?? []))
          .catch(() => [] as VercelDomainView[]),
      ]);

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
        domains,
        repo: toRepo(project),
        error: null,
      };
    }),
  );

  return views;
}
