"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ExternalLinkIcon,
  RefreshCwIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Transcript } from "@/components/deploy/transcript";
import { useVercelLogin, type VercelLoginState } from "@/components/integrations/use-vercel-login";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip, type Tone } from "@/components/ui/chip";
import { Field, TextInput } from "@/components/ui/field";
import { relative } from "@/lib/format";
import type { VercelLoginView, VercelOverview, VercelTokenSource } from "@/lib/types";

/**
 * Vercel: the account, and the way in.
 *
 * The two frontends are deployed as two Vercel projects built from this one
 * repository — `docs/deploy.md` is the document, and this page is the state of
 * what it describes: which projects exist, what they last deployed, what
 * `NEXT_PUBLIC_*` each was built with, and which domains each answers on.
 *
 * **Deploying is not here.** It lives on a frontend's own page — Frontends →
 * studio → Deployments — because a deploy is about *one app in one environment*,
 * and this page is about the account. What it does is the account-level half:
 * the state of both projects, and the token all of it is read and written with.
 *
 * What it writes is this machine: **Connect runs the Vercel CLI's own login** —
 * installing the CLI first if there is none — and the console then reads the
 * session the CLI keeps. That is the difference between a page that reports and a
 * page somebody can set up without leaving it, and it is why the button is a
 * transcript rather than a dialog: the CLI prints a device URL, and the person
 * approves it in a browser while the console watches the process it started.
 *
 * What the read is for is the one failure that is invisible from both ends: a
 * deployed frontend is built with `NEXT_PUBLIC_*` inlined, so it talks to
 * whichever API URL the *project* had when it was built. Set the wrong one, or
 * change it without redeploying, and the deployed app is pointed at `dev` while
 * every file in the repository says `staging`. Neither side looks wrong until
 * somebody reads the project, which is this.
 */
export function VercelView() {
  const [overview, setOverview] = useState<VercelOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useVercelLogin();

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/vercel", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { vercel?: VercelOverview; error?: string };
        if (body.vercel) setOverview(body.vercel);
        else setError(body.error ?? "Vercel could not be read.");
      })
      .catch(() => setError("Vercel could not be read."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // A finished sign-in changes what every other card on this page should say —
  // the CLI's session is now the console's token — so the read is taken again.
  // That is the whole handshake between the flow and the page.
  const finished = login.login?.status === "done";
  useEffect(() => {
    if (finished) load();
  }, [finished, load]);

  const save = async (value: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/vercel", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      const body = (await response.json()) as { vercel?: VercelOverview; error?: string };
      if (body.vercel) setOverview(body.vercel);
      else setError(body.error ?? "The token could not be saved.");
      setToken("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vercel</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            The account both frontends are deployed to. This page reads it; deploying one happens
            on the frontend&rsquo;s own page, under Deployments.
          </p>
        </div>
        {overview ? (
          // Three states, not two: a token can be configured and still not read
          // anything, which is exactly what a lapsed session looks like — and
          // calling that "connected" over a red banner would be the chip lying.
          <Chip tone={overview.error ? "bad" : overview.connected ? "ok" : "muted"}>
            {overview.error ? "error" : overview.connected ? "connected" : "not connected"}
          </Chip>
        ) : null}
      </header>

      {overview?.error || error || login.error ? (
        <div className="border-destructive/35 bg-destructive/10 text-destructive flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">{overview?.error ?? error ?? login.error}</p>
        </div>
      ) : null}

      <ConnectCard overview={overview} login={login} />

      <Card>
        <CardHeading
          title="Access token"
          hint="The way in that needs no CLI: a Vercel token with read access to the two projects, stored in apps/play/.env.local, which is gitignored — or VERCEL_TOKEN in your shell, which wins over everything else."
          action={
            <IconButton onClick={load} title="Refresh" aria-label="Refresh">
              <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            </IconButton>
          }
        />

        <div className="mt-5 flex flex-col gap-4">
          <Field
            label={overview?.connected ? "Replace the token" : "Token"}
            htmlFor="vercel-token"
            hint={
              overview?.tokenSource === "environment"
                ? "A token is set in the environment, so anything saved here is ignored until that is unset."
                : overview?.tokenSource === "cli"
                  ? "The console is reading the Vercel CLI's session, so a token saved here waits until there is none — `vercel logout` in a terminal settles which one it is."
                  : overview?.tokenSource === "file"
                    ? "A token is stored in apps/play/.env.local."
                    : "Create one at vercel.com/account/tokens — or connect with the CLI above, which needs no token pasted at all."
            }
          >
            <TextInput
              id="vercel-token"
              type="password"
              value={token}
              spellCheck={false}
              autoComplete="new-password"
              placeholder={overview?.connected ? "•••••••• (connected)" : "vercel_…"}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={overview?.connected ? "secondary" : "primary"}
              onClick={() => void save(token)}
              busy={saving}
              disabled={!token}
            >
              {overview?.connected ? "Replace token" : "Connect"}
            </Button>
            {overview?.tokenSource === "file" ? (
              <Button variant="ghost" onClick={() => void save(null)} busy={saving}>
                Disconnect
              </Button>
            ) : null}
            {overview?.tokenSource ? (
              <span className="text-muted-foreground text-xs">
                reading from {SOURCE_LABEL[overview.tokenSource]}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">Nothing set.</span>
            )}
          </div>
        </div>
      </Card>

      {overview?.connected && !overview.error
        ? overview.projects.map((project) => (
            <Card key={project.name}>
              <CardHeading
                title={project.name}
                hint={
                  project.found
                    ? `${project.rootDirectory ?? project.rootDirectory} · built from this repository`
                    : "No project by this name on the account. The name is whatever you chose when importing — docs/deploy.md describes the two."
                }
                action={
                  <Chip tone={project.found ? "ok" : "muted"}>
                    {project.found ? "found" : "missing"}
                  </Chip>
                }
              />

              {project.found ? (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {project.prodUrl ? (
                      <a
                        href={project.prodUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 font-mono text-xs underline underline-offset-4"
                      >
                        {project.prodUrl.replace("https://", "")}
                        <ExternalLinkIcon className="size-3" />
                      </a>
                    ) : null}

                    <Link
                      href={`/frontends/${project.app}?tab=deployments`}
                      className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-4"
                    >
                      Deploy {project.app}
                    </Link>
                  </div>

                  <p className="text-muted-foreground mt-5 text-xs font-medium tracking-wide uppercase">
                    Domains
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {project.domains.length ? (
                      project.domains.map((domain) => (
                        <Chip key={domain.name} tone={domain.verified ? "ok" : "warn"} monospace>
                          {domain.name}
                        </Chip>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        None on the project — it answers on{" "}
                        <span className="font-mono">*.vercel.app</span> only. A frontend&rsquo;s
                        Deployments tab can add one.
                      </p>
                    )}
                  </div>

                  <p className="text-muted-foreground mt-5 text-xs font-medium tracking-wide uppercase">
                    Variables inlined at build time
                  </p>
                  <div className="mt-2 flex flex-col">
                    {project.env.length ? (
                      project.env.map((variable) => (
                        <div
                          key={variable.key}
                          className="border-border/40 flex flex-wrap items-baseline gap-3 border-t py-2 text-xs"
                        >
                          <span className="w-64 shrink-0 font-mono">{variable.key}</span>
                          <code className="min-w-0 flex-1 truncate" title={variable.value ?? ""}>
                            {variable.value ??
                              (variable.type === "sensitive"
                                ? "— sensitive, never returned"
                                : "— stored encrypted, so Vercel will not return it")}
                          </code>
                          <span className="text-muted-foreground shrink-0">
                            {variable.targets.join(", ")}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        No NEXT_PUBLIC_* variables on this project — a build would have no API URL.
                      </p>
                    )}
                  </div>

                  <p className="text-muted-foreground mt-6 text-xs font-medium tracking-wide uppercase">
                    Recent deployments
                  </p>
                  <div className="mt-2 flex flex-col">
                    {project.deployments.map((deployment) => (
                      <div
                        key={deployment.id || `${deployment.createdAt}`}
                        className="border-border/40 flex flex-wrap items-baseline gap-3 border-t py-2.5 text-xs"
                      >
                        <Chip tone={tone(deployment.state)} className="shrink-0">
                          {deployment.state}
                        </Chip>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {deployment.createdAt
                            ? relative(deployment.createdAt, Date.now())
                            : "—"}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          {deployment.target ?? "preview"}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {deployment.commitMessage ?? deployment.branch ?? "—"}
                        </span>
                        {deployment.url ? (
                          <a
                            href={deployment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground shrink-0 font-mono"
                          >
                            open
                          </a>
                        ) : null}
                      </div>
                    ))}
                    {project.deployments.length === 0 ? (
                      <p className="text-muted-foreground text-xs">No deployments recorded.</p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </Card>
          ))
        : null}

      <Card>
        <CardHeading title="What this page is for" />
        <div className="text-muted-foreground mt-4 flex flex-col gap-2 text-xs leading-relaxed">
          <p>
            <span className="text-foreground/80">
              A deployed frontend is built with its variables frozen in.
            </span>{" "}
            Next substitutes <span className="font-mono">NEXT_PUBLIC_*</span> while compiling, so the
            value a visitor&rsquo;s browser uses is the one the project had at build time. Change a
            variable and nothing happens until a redeploy; set the wrong one and the deployed app
            talks to <span className="font-mono">dev</span> while every{" "}
            <span className="font-mono">.env.local</span> in the repository says{" "}
            <span className="font-mono">staging</span>.
          </p>
          <p>
            <span className="text-foreground/80">Deploying lives on the frontend, not here.</span>{" "}
            Frontends → an app → <span className="font-mono">Deployments</span> writes a backend
            environment&rsquo;s five stack outputs into one of Vercel&rsquo;s three targets, puts the
            app on a domain, and builds it — as a checklist you can read before pressing the button,
            with the build&rsquo;s own output underneath. It is there rather than here because a
            deploy is about one app in one environment, and this page is about the account.
          </p>
          <p>
            Comparing the table above with{" "}
            <span className="font-mono">Frontends → Env variables</span> is how a mismatch is caught
            — the two should agree for the backend you mean.
          </p>
          <p>
            <span className="text-foreground/80">The demo is not here.</span> It is a third-party
            OAuth client of the same API rather than a product surface, so it has no Vercel project
            and is not deployed.
          </p>
        </div>
      </Card>
    </div>
  );
}

function tone(state: string) {
  if (state === "READY") return "ok" as const;
  if (state === "ERROR" || state === "CANCELED") return "bad" as const;
  if (state === "BUILDING" || state === "QUEUED" || state === "INITIALIZING") return "run" as const;
  return "muted" as const;
}

/* ------------------------------------------------------------------ *
 * Signing in
 * ------------------------------------------------------------------ */

/**
 * The one card on this page that runs something.
 *
 * It is a transcript rather than a dialog box, and that is the design: the CLI
 * prints a device URL, prints nothing at all while it waits, and prints what it
 * thinks went wrong when it does — all of which is worth seeing, and none of
 * which survives being hidden behind a spinner. The URL is *also* lifted out and
 * put beside the button, because it is the one thing the person has to act on.
 */
function ConnectCard({
  overview,
  login,
}: {
  overview: VercelOverview | null;
  login: VercelLoginState;
}) {
  const view = login.login;
  const running = view?.status === "running";
  const viaCli = overview?.tokenSource === "cli";
  const installed = overview?.cli.installed ?? true;
  const expired =
    viaCli && overview?.cli.tokenExpiresAt ? overview.cli.tokenExpiresAt * 1000 < Date.now() : false;

  return (
    <Card>
      <CardHeading
        title="Sign in with the Vercel CLI"
        hint={
          installed
            ? "Runs `vercel login` — the CLI's own device flow — and then reads the session it writes, so no token is pasted and none is copied out of the CLI's store."
            : "The Vercel CLI is not on this machine. Connecting installs it with `pnpm i -g vercel` and starts its login."
        }
        action={<Chip tone={LOGIN_TONE[view?.status ?? "idle"]}>{LOGIN_LABEL[view?.status ?? "idle"]}</Chip>}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => void login.start()}
          busy={login.starting}
          disabled={running}
          icon={<TerminalIcon className="size-4" />}
        >
          {running
            ? "Waiting for authentication…"
            : installed
              ? viaCli
                ? "Sign in again"
                : "Connect Vercel"
              : "Install and connect"}
        </Button>

        {running ? (
          <Button variant="ghost" onClick={() => void login.cancel()}>
            Cancel
          </Button>
        ) : null}

        {running && view?.url ? (
          <a
            href={view.url}
            target="_blank"
            rel="noreferrer"
            className="text-foreground/80 inline-flex items-center gap-1.5 text-xs underline underline-offset-4"
          >
            Open the device page
            <ExternalLinkIcon className="size-3" />
          </a>
        ) : null}

        {overview?.cli.path && !running ? (
          <span className="text-muted-foreground ml-auto font-mono text-xs">{overview.cli.path}</span>
        ) : null}
      </div>

      {viaCli && !running ? (
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          Reading from the CLI&rsquo;s session
          {overview?.cli.tokenExpiresAt
            ? expired
              ? ` — whose token lapsed ${relative(overview.cli.tokenExpiresAt * 1000, Date.now())}. The CLI refreshes it itself the next time you run it, or sign in again here.`
              : `. Vercel issues the CLI a short-lived token, so this may need signing in again on another day.`
            : "."}
        </p>
      ) : null}

      {login.error ? <p className="text-destructive mt-4 text-xs">{login.error}</p> : null}

      {login.lines.length > 0 || running ? (
        <Transcript
          className="mt-5"
          compact
          lines={login.lines}
          title={view?.step === "install" ? "pnpm i -g vercel" : "vercel login"}
          hint={
            view?.step === "install"
              ? "A global install, because the CLI is the thing that knows how to sign in."
              : "The device flow: open the URL, approve the code, and this finishes on its own."
          }
        />
      ) : null}
    </Card>
  );
}

const LOGIN_TONE: Record<VercelLoginView["status"], Tone> = {
  idle: "muted",
  running: "run",
  done: "ok",
  failed: "bad",
  cancelled: "warn",
};

const LOGIN_LABEL: Record<VercelLoginView["status"], string> = {
  idle: "not signed in",
  running: "signing in",
  done: "signed in",
  failed: "failed",
  cancelled: "cancelled",
};

/** Which of the three places the console is reading a token from. */
const SOURCE_LABEL: Record<VercelTokenSource, string> = {
  environment: "VERCEL_TOKEN",
  cli: "the Vercel CLI's session",
  file: "apps/play/.env.local",
};
