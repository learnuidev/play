import type {
  EnvRow,
  VercelDeployPreview,
  VercelDeployResult,
  VercelDeployTarget,
  VercelDomainView,
  VercelTarget,
  VercelVariableWrite,
} from "@/lib/types";
import type { PlanStep, StepContext } from "./plan";
import { FRONTEND_OUTPUTS, OUTPUT_ENV_NAME, OUTPUT_LABEL } from "./backend";
import { consoleDefaults, stageOutputs } from "./environments";
import { run } from "./exec";
import { requireVercelToken, vercelProject, vercelRequest, VERCEL_PROJECTS } from "./vercel";
import { stepsOf, type RunSpec } from "./run";

/**
 * Deploying a frontend.
 *
 * ## Why this is a plan and not six API calls
 *
 * Because six API calls that report "done" hide the only thing worth knowing
 * about a frontend deployment: **`NEXT_PUBLIC_*` is inlined at build time.**
 * Writing a variable changes nothing a visitor can see until the app is rebuilt,
 * and the rebuild is what makes the new value real. So the plan is
 * variables → domain → build → the domain on the build → the build's result, in
 * that order, with each step able to say it was already true.
 *
 * ## `stage` and `target` are two different questions
 *
 * They look like one and are not, which is why the form asks for both:
 *
 * - **`stage`** — which *backend*. It decides the values: the five stack outputs
 *   `docs/deploy.md` calls "the backend variables", read from
 *   `PlayApiStack-<stage>` and `PlayAuthStack-<stage>`.
 * - **`target`** — where *in Vercel*. `production`, `preview` or `development`,
 *   the three sets a project resolves its variables against when it builds.
 *
 * `staging`'s API URL written to the `preview` target is a normal thing to want,
 * and it is the thing a console that conflated the two could not express.
 *
 * ## Why `development` deploys nothing
 *
 * Vercel has three variable targets and **two deployment targets**: a build is
 * either production or preview. `development` is what `vercel env pull` and
 * `vercel dev` read on a laptop, so writing to it is real work and deploying to
 * it is a category error — which the plan says in a step, rather than letting
 * the API refuse it in a sentence about an unknown target.
 */

/** The Vercel project this repository builds for an app. */
function projectFor(app: VercelDeployTarget["app"]) {
  const wanted = VERCEL_PROJECTS.find((candidate) => candidate.app === app);
  if (!wanted) {
    throw new Error(
      `There is no Vercel project for '${app}'. The demo is a third-party client of the API ` +
        "rather than a product surface, so it is deployed nowhere — docs/deploy.md is the two " +
        "that are.",
    );
  }
  return wanted;
}

/** `NEXT_PUBLIC_API_URL` → "REST API base URL", so a row can say what a value is. */
const ENV_LABEL: Record<string, string> = Object.fromEntries(
  FRONTEND_OUTPUTS.map((output) => [OUTPUT_ENV_NAME[output], OUTPUT_LABEL[output] ?? output]),
);

/* ------------------------------------------------------------------ *
 * The values, which are a backend's outputs
 * ------------------------------------------------------------------ */

/**
 * The values this deploy writes, and where each one came from.
 *
 * `stageOutputs` already answers with the `NEXT_PUBLIC_*` names, because a
 * frontend's variables *are* a backend's outputs — that identification is the
 * whole of `server/frontends.ts` on the local side, and it is the same one here.
 * A stage with no API is not an error in the *table*: it is a plan that stops at
 * its second step, and the table says there is nothing to write.
 */
async function plannedVariables(
  input: VercelDeployTarget,
  ctx: { profile?: string; region?: string },
): Promise<{ values: Record<string, string>; rows: EnvRow[] }> {
  const outputs = await stageOutputs(input.stage, ctx);
  const values: Record<string, string> = { ...outputs.env };

  if (Object.keys(values).length === 0) {
    throw new Error(
      `'${input.stage}' has no deployed API, so there is nothing to point ${input.app} at. ` +
        `The values come from PlayApiStack-${input.stage} and PlayAuthStack-${input.stage}, ` +
        `and neither is deployed yet. Deploy the backend first — Backends → ${input.stage}.`,
    );
  }

  const rows: EnvRow[] = Object.entries(values)
    .map(([key, value]) => ({
      key,
      value,
      source: `Play…Stack-${input.stage} · ${ENV_LABEL[key] ?? "a stack output"}`,
      usedBy: [input.app],
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  // The studio's one extra value: where the marketplace lives. Not a stack
  // output — a domain — so the marketplace's own project is the only thing that
  // knows it. Getting it wrong is a publish card that links nowhere.
  if (input.app === "studio") {
    const url = await marketplaceUrl(input.stage);
    values.NEXT_PUBLIC_MARKETPLACE_URL = url;
    rows.push({
      key: "NEXT_PUBLIC_MARKETPLACE_URL",
      value: url,
      source: "the marketplace's domain, read from play-marketplace — not a stack output",
      usedBy: ["studio"],
    });
  }

  return { values, rows };
}

/**
 * Where the studio should send somebody who wants to browse courses.
 *
 * Read from the marketplace project's own domains first, because that is what is
 * *actually* serving — a `staging.lets-play.xyz` added to that project should be
 * the URL the studio links to, and nothing in this repository knows it. The rule
 * (`<stage>.lets-play.xyz`) is the fallback, and the row says which one was used,
 * because a derived URL that is wrong is a link to somebody else's 404.
 */
async function marketplaceUrl(stage: string): Promise<string> {
  try {
    const project = await vercelProject("play-marketplace");
    const wanted = stage === "dev" ? "lets-play.xyz" : `${stage}.lets-play.xyz`;
    const matching = project?.domains.find((domain) => domain.name === wanted);
    if (matching) return `https://${matching.name}`;
  } catch {
    // Not being able to read the marketplace's domains is not a reason to fail a
    // studio deploy: the rule is the answer, and the row says it came from there.
  }
  return stage === "dev" ? "https://lets-play.xyz" : `https://${stage}.lets-play.xyz`;
}

/* ------------------------------------------------------------------ *
 * The steps
 * ------------------------------------------------------------------ */

export function buildVercelPlan(input: VercelDeployTarget): PlanStep[] {
  const project = projectFor(input.app);

  /**
   * The project, and the sentence for a name that is not one.
   *
   * **The console does not create projects.** Importing a repository into Vercel
   * is a Git connection, a Root Directory and Vercel's own "include source files
   * outside of the Root Directory" setting — three decisions made once, in
   * `docs/deploy.md`, on a page that also installs the GitHub app on the account.
   * A project created from an API call that guessed at all three would be a
   * project somebody then has to go and inspect.
   */
  const projectStep: PlanStep = {
    id: "project",
    title: "The Vercel project exists",
    detail: `\`${project.name}\` builds \`${project.rootDirectory}\` from this repository — one of the two projects \`docs/deploy.md\` walks through, with the Root Directory set to the app and "Include source files outside of the Root Directory in the Build Step" turned on, which is what lets it resolve \`@play/ui\` out of \`packages/ui\`. The console does not create projects: that page is where the Git connection is made, and a project made from here would be one nobody chose.`,
    satisfiedLabel: "Found",
    timeoutMs: 60_000,
    check: async (ctx) => {
      const { token } = requireVercelToken();
      const found = await vercelProject(project.name, { token });
      if (!found?.id) {
        return { satisfied: false, note: `no project named '${project.name}' on this Vercel account` };
      }
      ctx.data.projectId = found.id;
      return {
        satisfied: true,
        note: found.repo
          ? `${project.name} · builds ${found.repo.org}/${found.repo.repo} · ${found.rootDirectory ?? "no root directory"}`
          : `${project.name} · no Git repository linked`,
      };
    },
    apply: async () => {
      throw new Error(
        `There is no Vercel project named '${project.name}' on the account this token belongs to.\n\n` +
          `Import this repository once, with Root Directory \`${project.rootDirectory}\` and "Include ` +
          `source files outside of the Root Directory in the Build Step" enabled — docs/deploy.md has ` +
          `the three settings, and what each one breaks without it. The console writes variables to a ` +
          `project rather than creating one, because the name and the Git connection are choices.`,
      );
    },
  };

  /**
   * The variables, which are the reason to be on this page at all.
   *
   * Written for **one target** — the one the form asked for — rather than for all
   * three, and that is the difference between this and setting them by hand in
   * the dashboard: the point of a `staging` deploy is that its values live in
   * `preview` while production keeps pointing at the backend it always did.
   */
  const variablesStep: PlanStep = {
    id: "variables",
    title: `${input.stage}'s values are on the project`,
    detail: `The five stack outputs \`docs/deploy.md\` calls "the backend variables", written to the **${input.target}** target of \`${project.name}\`: the API URL, the pool and its app client, the Hosted UI domain, and whether Google sign-in is on. The studio gets \`NEXT_PUBLIC_MARKETPLACE_URL\` as well, because nothing in it can work out where the marketplace is. Vercel resolves these per target at build time, and every one is inlined into the JavaScript a visitor downloads — so a value written here changes nothing until the next build, which is the step after this.`,
    satisfiedLabel: "Already set",
    timeoutMs: 3 * 60_000,
    check: async (ctx) => {
      const token = requireVercelToken().token;
      const projectId = await projectIdOf(ctx, token, project.name);
      const { values } = await plannedVariables(input, ctx);
      const env = await readEnv(token, projectId);

      ctx.data.planned = values;
      // Filled in here as well as in the apply, because a run whose variables
      // were already right still has to be able to say *which* ones. The result
      // card reads this, and an empty list reads as "nothing is set" rather than
      // "nothing needed changing".
      ctx.data.writes = Object.entries(values).map(([key, value]) => ({
        key,
        value,
        target: input.target,
        action: "unchanged" as const,
      }));

      const differ: string[] = [];
      const unreadable: string[] = [];

      for (const [key, value] of Object.entries(values)) {
        const current = currentFor(env, key, input.target);
        if (current.state === "unset") differ.push(key);
        else if (current.state === "unreadable") unreadable.push(key);
        else if (current.value !== value) differ.push(key);
      }

      if (differ.length === 0 && unreadable.length === 0) {
        return {
          satisfied: true,
          note: `${Object.keys(values).length} variables already read ${input.stage} in ${input.target}`,
        };
      }
      if (differ.length === 0) {
        return {
          satisfied: false,
          note: `${unreadable.length} of ${Object.keys(values).length} are stored encrypted, so their values cannot be read back — they will be rewritten`,
        };
      }
      return {
        satisfied: false,
        note: `${differ.length} of ${Object.keys(values).length} differ in ${input.target} — ${differ.join(", ")}`,
      };
    },
    apply: async (ctx) => {
      const token = requireVercelToken().token;
      const projectId = await projectIdOf(ctx, token, project.name);
      const { values } = await plannedVariables(input, ctx);

      ctx.log(
        "note",
        `$ ${Object.keys(values).length} values → ${project.name}, target ${input.target}`,
      );
      const writes = await writeVariables(ctx, token, projectId, values, input.target);
      ctx.data.writes = writes;

      const created = writes.filter((write) => write.action === "created").length;
      const updated = writes.filter((write) => write.action === "updated").length;
      const split = writes.filter((write) => write.action === "narrowed");

      if (split.length > 0) {
        ctx.log(
          "note",
          `${split.map((write) => write.key).join(", ")} used to cover several targets at once. ` +
            `They no longer cover ${input.target} and a value of their own was created instead — ` +
            "that is what a value *for this environment* means, and the other targets are untouched.",
        );
      }

      return {
        note: `${created} created · ${updated} updated${split.length ? ` · ${split.length} split off` : ""} · target ${input.target}`,
        status: created + updated === 0 ? "skipped" : "passed",
      };
    },
  };

  /**
   * The domain.
   *
   * Optional, and deliberately so: a domain another team holds, or one whose DNS
   * has not been pointed yet, is not a reason to refuse to build the app. The
   * deployment still lands on its own `*.vercel.app` URL and this step warns and
   * carries on — with Vercel's own DNS record printed in the transcript, because
   * *that* is the thing somebody has to go and do, and "follow Vercel's DNS
   * instructions" is not something a console should make you go and find.
   */
  const domainStep: PlanStep | null = input.domain
    ? {
        id: "domain",
        title: `${input.domain} is on the project`,
        detail: `Added to \`${project.name}\` if it is not already there, and reported with whatever Vercel says about its DNS. A domain is a *project*-level thing rather than a per-deployment one, so this is asked once and is a check mark afterwards. Optional, because DNS is somebody else's page and an app that builds without its domain is still an app that builds.`,
        optional: true,
        satisfiedLabel: "Already there",
        timeoutMs: 3 * 60_000,
        check: async (ctx) => {
          const token = requireVercelToken().token;
          const projectId = await projectIdOf(ctx, token, project.name);
          const existing = await readDomains(token, projectId);
          const found = existing.find(
            (domain) => domain.name.toLowerCase() === input.domain!.toLowerCase(),
          );
          ctx.data.domain = found ?? null;
          return found
            ? { satisfied: true, note: describeDomain(found, project.name) }
            : { satisfied: false, note: `${input.domain} is not on ${project.name}` };
        },
        apply: async (ctx) => {
          const token = requireVercelToken().token;
          const projectId = await projectIdOf(ctx, token, project.name);
          const name = input.domain!;

          ctx.log("note", `$ POST /v10/projects/${projectId}/domains ${name}`);
          await vercelRequest(token, `/v10/projects/${encodeURIComponent(projectId)}/domains`, {
            method: "POST",
            body: { name },
          });

          // Read back rather than trust the add call's own answer: whether a
          // domain is *configured* is a fact about DNS, and the add returns
          // before anybody's nameserver has been asked.
          const [domain, records] = await Promise.all([
            vercelRequest<RawDomain>(
              token,
              `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(name)}`,
            ).catch(() => null),
            dnsRecords(token, name),
          ]);

          const view: VercelDomainView = {
            name: domain?.name ?? name,
            verified: domain?.verified ?? false,
            gitBranch: domain?.gitBranch ?? null,
            records,
          };
          ctx.data.domain = view;

          for (const record of records) ctx.log("out", `DNS   ${record}`);
          if (!view.verified) {
            ctx.log(
              "note",
              `${name} is added but not verified yet. Vercel serves it once the record above is ` +
                "in place; this deploy carries on and builds without it.",
            );
          }
          return { note: describeDomain(view, project.name) };
        },
      }
    : null;

  /**
   * The build.
   *
   * No check, on purpose — the same reasoning as `cdk deploy` in the backend's
   * plan: there is no cheap way to ask "would this change anything" other than
   * doing it, and this is the step that makes the variables above real.
   *
   * ## Which source, and why it is not a choice
   *
   * Vercel builds from GitHub, not from this machine — `docs/deploy.md` says so
   * in its first table — so a deployment names a **ref**, and the ref it names is
   * the one checked out here. Somebody on `staging` deploys the `staging` branch.
   * A project with no Git connection can only rebuild its last deployment of this
   * target, which the step does and says so.
   */
  const deployStep: PlanStep = {
    id: "deploy",
    title: "The app is built",
    detail:
      "A deployment, created for this target. Vercel builds it from the Git repository the project is linked to — the branch this checkout is on, because that is the code somebody is looking at — and the values written above are inlined into it. A project with no Git connection is rebuilt from its last deployment of this target instead, which is the only source it has left.",
    timeoutMs: 2 * 60_000,
    apply: async (ctx) => {
      if (input.target === "development") {
        return {
          note: "the development target is not a deployment — `vercel env pull` and `vercel dev` read it on a laptop",
          status: "skipped",
        };
      }

      const token = requireVercelToken().token;
      const projectId = await projectIdOf(ctx, token, project.name);
      const full = await vercelProject(project.name, { token });
      const source = await buildSource(ctx, full, input.target);

      ctx.log(
        "note",
        source.kind === "git"
          ? `$ POST /v13/deployments gitSource ${source.ref}`
          : `$ POST /v13/deployments redeploy ${source.deploymentId}`,
      );

      const created = await vercelRequest<RawFullDeployment>(
        token,
        `/v13/deployments${source.kind === "redeploy" ? "?forceNew=1" : ""}`,
        {
          method: "POST",
          body:
            source.kind === "git"
              ? {
                  name: project.name,
                  project: projectId,
                  ...(input.target === "production" ? { target: "production" } : {}),
                  gitSource: { type: "github", repoId: source.repoId, ref: source.ref },
                }
              : {
                  name: project.name,
                  deploymentId: source.deploymentId,
                  ...(input.target === "production" ? { target: "production" } : {}),
                },
        },
      );

      const deployment = toDeploymentView(created);
      if (!deployment.id) {
        throw new Error("Vercel accepted the deployment but returned no id, so it cannot be followed.");
      }
      ctx.data.deployment = deployment;
      ctx.log("out", `created ${deployment.id} · ${deployment.url ?? "no URL yet"}`);
      return { note: `${deployment.id.slice(0, 14)} · ${source.note}` };
    },
  };

  /**
   * The domain, on *this* build — and **after** the build is ready.
   *
   * The step that makes a domain mean something for a preview: Vercel points a
   * project's custom domains at whatever it considers production, so
   * `staging.studio.lets-play.xyz` serving a `preview` deployment is an
   * **alias** — assigned here to the deployment this run made, rather than to
   * "the latest" in the hope that it is the same one.
   *
   * It comes last for a reason Vercel is explicit about: aliasing a deployment
   * that is still building is refused with
   * `The deployment readyState is not READY`, so an alias step before the build
   * has finished is a step that always warns. The order is the whole fix.
   */
  const aliasStep: PlanStep | null = input.domain
    ? {
        id: "alias",
        title: `${input.domain} serves this deployment`,
        detail: `An alias from the deployment this run created to the domain — which is what makes a custom domain serve a **preview** build, since a project's domains otherwise follow production. It runs *after* the build settles, because Vercel refuses to alias a deployment that is not \`READY\`, and it reads the deployment back rather than assuming, so a check mark here means Vercel agrees. Optional, like the step that added the domain: a build that cannot be aliased is still a build.`,
        optional: true,
        satisfiedLabel: "Pointing here",
        timeoutMs: 2 * 60_000,
        check: async (ctx) => {
          const deployment = ctx.data.deployment as { id?: string; aliases?: string[] } | undefined;
          if (!deployment?.id) {
            // Not a failure: the development target has no deployment by design,
            // and there is nothing for a domain to point at.
            return {
              satisfied: true,
              note: "no deployment for this target — the development target is read on a laptop",
            };
          }
          const points = (deployment.aliases ?? []).some(
            (alias) => alias.toLowerCase() === input.domain!.toLowerCase(),
          );
          return points
            ? { satisfied: true, note: `${input.domain} already resolves to ${deployment.id.slice(0, 14)}` }
            : { satisfied: false, note: `${input.domain} does not point at this deployment` };
        },
        apply: async (ctx) => {
          const deployment = ctx.data.deployment as { id?: string } | undefined;
          if (!deployment?.id) {
            throw new Error(
              "There is no deployment to put the domain on. A deployment exists for production " +
                "and preview builds only — the development target has none.",
            );
          }
          // Read the state back rather than trusting the earlier poll: the alias
          // is refused unless the deployment is ready *now*, and a check that
          // guessed would turn a refusal into a warning for no reason.
          const token = requireVercelToken().token;
          const current = await vercelRequest<RawFullDeployment>(
            token,
            `/v13/deployments/${encodeURIComponent(deployment.id)}`,
          );
          const state = (current.readyState ?? current.state ?? "").toUpperCase();
          if (state !== "READY") {
            throw new Error(
              `The deployment is ${state || "not ready"}, and Vercel only aliases a deployment ` +
                `that is READY. It carries on building in Vercel — run this again once it is, or ` +
                `open Frontends → ${input.app} → Deployments.`,
            );
          }

          ctx.log("note", `$ POST /v2/deployments/${deployment.id}/aliases ${input.domain}`);
          await vercelRequest(token, `/v2/deployments/${encodeURIComponent(deployment.id)}/aliases`, {
            method: "POST",
            body: { alias: input.domain },
          });
          return { note: `${input.domain} → ${deployment.id.slice(0, 14)}` };
        },
      }
    : null;

  /**
   * The build, watched.
   *
   * The one step that waits, and the reason it is a step rather than a number in
   * a table afterwards: a Next build takes a couple of minutes, it fails in ways
   * only its own output explains, and "did it work" is the question whoever
   * pressed the button is waiting on. The states are printed as they change,
   * with the build's own log lines pulled along beside them.
   */
  const readyStep: PlanStep = {
    id: "ready",
    title: "The deployment is ready",
    detail:
      "Polled until Vercel reports a settled state — `READY`, `ERROR` or `CANCELED` — with the build's own log lines printed as they arrive. A run that is cancelled stops asking between polls, rather than at the end of the build.",
    satisfiedLabel: "Ready",
    timeoutMs: 25 * 60_000,
    check: async (ctx) => {
      const deployment = ctx.data.deployment as { state?: string } | undefined;
      if (!deployment) return { satisfied: false, note: "nothing was deployed for this target" };
      return deployment.state === "READY"
        ? { satisfied: true, note: "the deployment came back ready" }
        : { satisfied: false, note: `the deployment is ${deployment.state ?? "queued"}` };
    },
    apply: async (ctx) => {
      const deployment = ctx.data.deployment as { id?: string } | undefined;
      if (!deployment?.id) {
        return {
          note: "nothing to wait for — the development target produces no deployment",
          status: "skipped",
        };
      }
      return watchDeployment(ctx, requireVercelToken().token, deployment.id);
    },
  };

  return [
    projectStep,
    variablesStep,
    ...(domainStep ? [domainStep] : []),
    deployStep,
    // Ready before alias, and not the other way round: Vercel refuses to point a
    // domain at a deployment that is still building.
    readyStep,
    ...(aliasStep ? [aliasStep] : []),
  ];
}

/* ------------------------------------------------------------------ *
 * The run, and what the page reads before one
 * ------------------------------------------------------------------ */

/** The run a frontend deploy starts, as the engine wants it. */
export function vercelRunSpec(input: VercelDeployTarget): RunSpec {
  const { profile, region } = consoleDefaults();

  return {
    kind: "frontend",
    // One deploy per Vercel *project*, so the app is the subject: two builds
    // racing on one project would publish over each other, while studio and
    // marketplace are two projects and may build at once.
    key: input.app,
    subject: `${input.app} → ${input.target}`,
    stage: input.stage,
    profile,
    region,
    vercel: input,
    steps: buildVercelPlan(input),
    // Read out of what the steps left behind rather than tracked beside them, so
    // a run that failed halfway still reports the variables it did write.
    deployment: (data): VercelDeployResult => ({
      deployment: (data.deployment as VercelDeployResult["deployment"]) ?? null,
      variables: (data.writes as VercelVariableWrite[]) ?? [],
      domain: (data.domain as VercelDomainView | null) ?? null,
    }),
  };
}

/**
 * What the deploy page shows before anybody presses anything.
 *
 * The same checklist a run would execute, plus the two things that make this a
 * *Vercel* deploy rather than a generic one: which values would be written, and
 * where the build would come from. Both are read rather than assumed, so the page
 * can say "3 of 6 differ" before the button is pressed rather than after.
 */
export async function vercelDeployPreview(input: VercelDeployTarget): Promise<VercelDeployPreview> {
  const { profile, region } = consoleDefaults();

  let project: VercelDeployPreview["project"] = null;
  let variables: EnvRow[] = [];
  let note: string | null = null;

  try {
    project = await vercelProject(projectFor(input.app).name);
  } catch (error) {
    // No token, or a token Vercel refuses. The checklist still draws — its first
    // step is the one that stops — and this says why in a sentence.
    note = error instanceof Error ? error.message : String(error);
  }

  try {
    variables = (await plannedVariables(input, { profile, region })).rows;
  } catch (error) {
    note ??= error instanceof Error ? error.message : String(error);
  }

  return {
    target: input,
    project,
    variables,
    source: describeSource(project?.repo ?? null, input.target),
    note,
    steps: stepsOf(buildVercelPlan(input)),
  };
}

/**
 * Where the build would come from, in one sentence.
 *
 * Kept next to the plan because it is the same decision the deploy step makes,
 * and a page that described a different one would be describing a deploy
 * somebody is not about to run.
 */
function describeSource(
  repo: { org: string; repo: string; productionBranch: string | null } | null,
  target: VercelTarget,
): string {
  if (target === "development") {
    return "no build — the development target is read on a laptop, not deployed";
  }
  if (!repo) {
    return "no Git connection on the project, so its last deployment of this target is rebuilt";
  }
  const production = repo.productionBranch ? ` — or ${repo.productionBranch} for production` : "";
  return `built from ${repo.org}/${repo.repo}, from the branch this checkout is on${production}`;
}

/* ------------------------------------------------------------------ *
 * The Vercel client, as these steps use it
 * ------------------------------------------------------------------ */

interface RawEnvRecord {
  id?: string;
  key: string;
  value?: string;
  type?: string;
  target?: string[] | string;
  gitBranch?: string | null;
}

interface RawDomain {
  name?: string;
  verified?: boolean;
  gitBranch?: string | null;
}

interface RawFullDeployment {
  id?: string;
  uid?: string;
  url?: string | null;
  readyState?: string;
  state?: string;
  target?: string | null;
  created?: number;
  created_at?: number;
  alias?: string[];
  aliasFinal?: string | null;
  meta?: { githubCommitRef?: string; githubCommitMessage?: string; githubCommitSha?: string };
  errorMessage?: string | null;
}

const targetsOf = (record: RawEnvRecord): string[] =>
  Array.isArray(record.target) ? record.target : record.target ? [record.target] : [];

/**
 * The project's id, once per run.
 *
 * Cached in `ctx.data` because the check and the apply of one step both need it
 * and a run makes eight calls that all want the same string. Resolved rather
 * than passed in, so a project renamed between the page loading and the button
 * being pressed is reported by the step that needed it.
 */
async function projectIdOf(ctx: StepContext, token: string, name: string): Promise<string> {
  const cached = ctx.data.projectId;
  if (typeof cached === "string" && cached) return cached;

  const found = await vercelProject(name, { token });
  if (!found?.id) {
    throw new Error(`'${name}' did not resolve to a project with an id on this Vercel account.`);
  }
  ctx.data.projectId = found.id;
  return found.id;
}

async function readEnv(token: string, projectId: string): Promise<RawEnvRecord[]> {
  const body = await vercelRequest<{ envs?: RawEnvRecord[] }>(
    token,
    `/v10/projects/${encodeURIComponent(projectId)}/env?decrypt=true`,
  );
  return body.envs ?? [];
}

/**
 * What a key currently reads as, for one target.
 *
 * Four answers, and the interesting one is `unreadable`. Vercel will not return
 * an `encrypted` variable's value — it returns an envelope, and `decrypt=true`
 * is deprecated and no longer opens it — so a comparison cannot be made. That is
 * reported rather than guessed at in either direction: assuming a match would
 * skip a write that is needed, and assuming a difference would claim to know
 * something this call did not learn.
 *
 * Only a record that names this target *alone* counts. One that also covers
 * another target is a different answer to the question — it is the shape a
 * hand-set variable has — and `writeVariable` is what deals with it.
 */
type Current =
  | { state: "unset" }
  | { state: "unreadable"; type: string }
  | { state: "set"; value: string };

function currentFor(env: RawEnvRecord[], key: string, target: VercelTarget): Current {
  const record = env.find(
    (entry) => entry.key === key && targetsOf(entry).length === 1 && targetsOf(entry)[0] === target,
  );
  if (!record) return { state: "unset" };

  const type = record.type ?? "plain";
  if (type === "encrypted" || type === "sensitive" || typeof record.value !== "string") {
    return { state: "unreadable", type };
  }
  return { state: "set", value: record.value };
}

async function readDomains(token: string, projectId: string): Promise<VercelDomainView[]> {
  const body = await vercelRequest<{ domains?: RawDomain[] }>(
    token,
    `/v9/projects/${encodeURIComponent(projectId)}/domains`,
  );
  return (body.domains ?? [])
    .filter((domain): domain is RawDomain & { name: string } => Boolean(domain.name))
    .map((domain) => ({
      name: domain.name,
      verified: domain.verified ?? false,
      gitBranch: domain.gitBranch ?? null,
      records: [],
    }));
}

/**
 * Write one value for one target, and say which of the three things happened.
 *
 * The rule is **one record per key per target**, and it is the interesting part
 * of this file. Vercel lets a single record cover several targets at once —
 * `["production", "preview", "development"]` is what `docs/deploy.md` tells you
 * to create by hand — so a value for `preview` alone is not one the API can
 * simply overwrite. A second record that also covered `preview` would be two
 * answers to one question, so instead the spanning record is **narrowed**: the
 * target being written is taken out of it and a record of its own is created.
 * That is what "a value for this environment" means, the other targets are left
 * exactly as they were, and the transcript says it happened.
 */
async function writeVariable(
  ctx: StepContext,
  token: string,
  projectId: string,
  env: RawEnvRecord[],
  key: string,
  value: string,
  target: VercelTarget,
): Promise<VercelVariableWrite> {
  const records = env.filter((record) => record.key === key);
  const route = `/v9/projects/${encodeURIComponent(projectId)}/env`;

  /**
   * A patch that also puts the record back to `plain`.
   *
   * Every one of these values is inlined into the JavaScript a visitor downloads,
   * so `encrypted` buys nothing and costs the one thing that matters: **an
   * encrypted value cannot be read back**, by this console or by the API, which
   * makes "is the deployed app pointed at the right backend" unanswerable —
   * exactly the question this page exists for.
   *
   * Changing a record's type is not something Vercel's dashboard offers, so it is
   * attempted rather than assumed: if the API refuses, the value is written on its
   * own and the transcript says the record stays encrypted. A refusal costs one
   * extra call, not the deploy.
   */
  const patchValue = async (id: string, extra: Record<string, unknown> = {}) => {
    try {
      return await vercelRequest(token, `${route}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { value, type: "plain", ...extra },
      });
    } catch {
      ctx.log(
        "note",
        `${key} — Vercel refused to un-encrypt this record, so its value stays unreadable here`,
      );
      return vercelRequest(token, `${route}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { value, ...extra },
      });
    }
  };

  const exact = records.find(
    (record) => targetsOf(record).length === 1 && targetsOf(record)[0] === target,
  );
  if (exact?.id) {
    const wasEncrypted = exact.type === "encrypted" || exact.type === "sensitive";
    const current =
      wasEncrypted || typeof exact.value !== "string"
        ? null
        : exact.value;

    if (current === value) {
      ctx.log("note", `${key} — already ${value} in ${target}`);
      return { key, value, target, action: "unchanged" };
    }

    await patchValue(exact.id);
    ctx.log(
      "note",
      wasEncrypted
        ? `${key} — was stored encrypted, so its old value could not be read; set to ${value} in ${target} as plain`
        : `${key} — ${current ?? "(no value)"} → ${value} in ${target}`,
    );
    return { key, value, target, action: "updated" };
  }

  const spanning = records.find(
    (record) => targetsOf(record).includes(target) && targetsOf(record).length > 1,
  );
  if (spanning?.id) {
    const rest = targetsOf(spanning).filter((candidate) => candidate !== target);
    await patchValue(spanning.id, { target: rest, value: spanning.value ?? value });
    await createVariable(token, projectId, key, value, target);
    ctx.log(
      "note",
      `${key} — was shared across ${targetsOf(spanning).join(", ")}; narrowed to ${rest.join(", ")} and set to ${value} in ${target}`,
    );
    return { key, value, target, action: "narrowed" };
  }

  await createVariable(token, projectId, key, value, target);
  ctx.log("note", `${key} — created in ${target} as ${value}`);
  return { key, value, target, action: "created" };
}

/**
 * `plain` rather than `encrypted`, and that is a decision worth stating.
 *
 * Every one of these values is inlined into the JavaScript a visitor downloads
 * — `docs/deploy.md` says as much — so treating them as secrets would hide them
 * from the one person who has to notice that the deployed app is pointed at
 * `dev`. Vercel's dashboard and this console's env table should both show them.
 */
async function createVariable(
  token: string,
  projectId: string,
  key: string,
  value: string,
  target: VercelTarget,
): Promise<void> {
  await vercelRequest(token, `/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`, {
    method: "POST",
    body: { key, value, type: "plain", target: [target] },
  });
}

async function writeVariables(
  ctx: StepContext,
  token: string,
  projectId: string,
  values: Record<string, string>,
  target: VercelTarget,
): Promise<VercelVariableWrite[]> {
  const env = await readEnv(token, projectId);
  const writes: VercelVariableWrite[] = [];

  for (const [key, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    writes.push(await writeVariable(ctx, token, projectId, env, key, value, target));
  }
  return writes;
}

/**
 * Vercel's own answer for what a domain's DNS should say.
 *
 * Two shapes for the same host: a `CNAME` when the domain is a subdomain of a
 * zone somebody controls, and `A` records when it is an apex. Both are returned
 * ranked, and the lowest rank is the one Vercel recommends.
 */
async function dnsRecords(token: string, domain: string): Promise<string[]> {
  try {
    const config = await vercelRequest<{
      recommendedCNAME?: Array<{ rank?: number; value?: string }>;
      recommendedIPv4?: Array<{ rank?: number; value?: string[] }>;
    }>(token, `/v6/domains/${encodeURIComponent(domain)}/config`);

    const byRank = <T extends { rank?: number }>(entries: T[] | undefined) =>
      (entries ?? []).slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];

    const cname = byRank(config.recommendedCNAME)?.value;
    if (cname) return [`CNAME ${domain} → ${cname}`];

    const ipv4 = byRank(config.recommendedIPv4)?.value ?? [];
    if (ipv4.length > 0) return ipv4.map((address) => `A     ${domain} → ${address}`);

    return [`nothing Vercel can recommend for ${domain} until its nameservers are Vercel's`];
  } catch {
    // A config read that fails is not a reason to fail a deploy; the domain is
    // added either way, and the Vercel dashboard shows the same record.
    return [];
  }
}

function describeDomain(domain: VercelDomainView, projectName: string): string {
  return `${domain.name} · ${domain.verified ? "verified" : "added, waiting on DNS"} on ${projectName}`;
}

/* ------------------------------------------------------------------ *
 * The build
 * ------------------------------------------------------------------ */

type BuildSource =
  | { kind: "git"; repoId: number; ref: string; note: string }
  | { kind: "redeploy"; deploymentId: string; note: string };

/**
 * Which ref a deployment builds, or which deployment to rebuild.
 *
 * Git first, because that is what Vercel does — `docs/deploy.md`'s first table
 * says the repository has to be pushed, and a deployment is of a *branch*, not
 * of a working tree. The branch it names is the one checked out here, which is
 * the only answer this machine has. A project with no Git connection falls back
 * to rebuilding its last deployment of this target, because that is the only
 * source it has left.
 */
async function buildSource(
  ctx: StepContext,
  project: Awaited<ReturnType<typeof vercelProject>>,
  target: VercelTarget,
): Promise<BuildSource> {
  if (project?.repo?.repoId) {
    const ref =
      target === "production" ? (project.repo.productionBranch ?? "main") : await currentBranch(ctx.root);

    ctx.log("note", `building ${project.repo.org}/${project.repo.repo}@${ref} for ${target}`);
    return {
      kind: "git",
      repoId: project.repo.repoId,
      ref,
      note: `${project.repo.org}/${project.repo.repo}@${ref}`,
    };
  }

  const latest = project?.deployments.find(
    (deployment) => (deployment.target ?? "preview") === target,
  );
  if (!latest?.id) {
    throw new Error(
      `\`${project?.name ?? "The project"}\` has no Git connection and nothing has been deployed ` +
        `to '${target}' yet, so there is no source to build from.\n\n` +
        "Connect the repository to the project — docs/deploy.md's first table — or deploy " +
        `${target} once from the Vercel dashboard, and this step will rebuild what is there.`,
    );
  }

  ctx.log("note", `no Git connection — rebuilding ${latest.id} for ${target}`);
  return {
    kind: "redeploy",
    deploymentId: latest.id,
    note: `rebuilt ${latest.id.slice(0, 14)}`,
  };
}

/** The branch this checkout is on, which is what a preview deployment builds. */
async function currentBranch(root: string): Promise<string> {
  const result = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    timeoutMs: 15_000,
  }).catch(() => null);

  const branch = result?.code === 0 ? result.stdout.trim() : "";
  // A detached HEAD answers `HEAD`, which is not a ref Vercel can build.
  return branch && branch !== "HEAD" ? branch : "main";
}

function toDeploymentView(raw: RawFullDeployment) {
  return {
    id: raw.id ?? raw.uid ?? "",
    url: raw.url ? `https://${raw.url}` : null,
    state: (raw.readyState ?? raw.state ?? "QUEUED").toUpperCase(),
    target: raw.target ?? null,
    createdAt: raw.created ?? raw.created_at ?? null,
    branch: raw.meta?.githubCommitRef ?? null,
    commitMessage: raw.meta?.githubCommitMessage?.split("\n")[0] ?? null,
    commitSha: raw.meta?.githubCommitSha?.slice(0, 7) ?? null,
    aliases: [...(raw.alias ?? []), ...(raw.aliasFinal ? [raw.aliasFinal] : [])],
  };
}

const SETTLED = new Set(["READY", "ERROR", "CANCELED"]);

/**
 * Watch a build, and print what it says.
 *
 * Two reads per tick, and both earn their place: the deployment's own
 * `readyState`, which is the answer, and the build's log, which is the reason
 * when the answer is `ERROR`. A failed build reported as nothing but a red chip
 * sends somebody to the Vercel dashboard, and the log is right there.
 *
 * It stops asking the moment the run is cancelled — `ctx.stopped()` *between*
 * polls rather than after the build — because a Stop button that takes four
 * minutes to be obeyed is not a Stop button.
 */
async function watchDeployment(
  ctx: StepContext,
  token: string,
  deploymentId: string,
): Promise<{ note: string; status?: "passed" | "skipped" }> {
  const started = Date.now();
  const limit = 22 * 60_000;
  let last: string | null = null;
  let seenEvents = 0;
  let url: string | null = null;

  while (Date.now() - started < limit) {
    if (ctx.stopped()) {
      throw new Error("Stopped while the build was running. The deployment carries on in Vercel.");
    }

    const status = await vercelRequest<RawFullDeployment>(
      token,
      `/v13/deployments/${encodeURIComponent(deploymentId)}`,
    );

    const state = (status.readyState ?? status.state ?? "QUEUED").toUpperCase();
    url = status.url ? `https://${status.url}` : url;

    if (state !== last) {
      ctx.log("out", `${state}${url ? ` · ${url}` : ""}`);
      ctx.progress(`${state.toLowerCase()} · ${Math.round((Date.now() - started) / 1000)}s`);
      last = state;
    }

    seenEvents = await drainBuildLog(ctx, token, deploymentId, seenEvents);

    if (SETTLED.has(state)) {
      if (state === "READY") {
        return {
          note: `ready in ${Math.round((Date.now() - started) / 1000)}s · ${url ?? deploymentId}`,
        };
      }
      throw new Error(
        `The build ended ${state}${status.errorMessage ? ` — ${status.errorMessage}` : ""}. The ` +
          "lines above are what it printed; the deployment in Vercel has the whole log.",
      );
    }

    await sleep(4000);
  }

  return {
    note: `still building after ${Math.round((Date.now() - started) / 60_000)} minutes — it carries on in Vercel`,
    status: "skipped",
  };
}

/**
 * The build's own lines, from where the last read stopped.
 *
 * Counted rather than timestamped: the events endpoint takes a `since` in
 * milliseconds, and two lines inside one millisecond are two lines a timestamp
 * cursor would drop. Everything is fetched and the already-seen prefix skipped,
 * which costs a few kilobytes per poll and loses nothing.
 */
async function drainBuildLog(
  ctx: StepContext,
  token: string,
  deploymentId: string,
  seen: number,
): Promise<number> {
  try {
    const body = await vercelRequest<unknown>(
      token,
      `/v3/deployments/${encodeURIComponent(deploymentId)}/events?builds=1&direction=forward&limit=400`,
    );
    const events = (Array.isArray(body) ? body : []) as Array<{
      type?: string;
      payload?: { text?: string; info?: { name?: string; step?: string; readyState?: string } };
    }>;

    for (const [index, event] of events.entries()) {
      if (index < seen) continue;
      const text =
        event.payload?.text ??
        [event.payload?.info?.name, event.payload?.info?.step, event.payload?.info?.readyState]
          .filter(Boolean)
          .join(" ");
      if (text) ctx.log(event.type === "stderr" ? "err" : "out", text);
    }
    return events.length;
  } catch {
    // A build log that will not read is not a reason to fail a deploy: the
    // deployment's own state is the answer, and this is the colour around it.
    return seen;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
