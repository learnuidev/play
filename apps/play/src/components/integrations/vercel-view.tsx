"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, TextInput } from "@/components/ui/field";
import { relative } from "@/lib/format";
import type { VercelOverview } from "@/lib/types";

/**
 * Vercel, read-only.
 *
 * The two frontends are deployed as two Vercel projects built from this one
 * repository — `docs/deploy.md` is the document, and this page is the state of
 * what it describes. **The console never writes to Vercel**: no project is
 * created, no variable is set, no deployment is triggered. `docs/deploy.md` is
 * still how a deploy happens.
 *
 * What it is for is the one failure that is invisible from both ends: a deployed
 * frontend is built with `NEXT_PUBLIC_*` inlined, so it talks to whichever API
 * URL the *project* had when it was built. Set the wrong one, or change it
 * without redeploying, and the deployed app is pointed at `dev` while every file
 * in the repository says `staging`. Neither side looks wrong until somebody
 * reads the project, which is this.
 */
export function VercelView() {
  const [overview, setOverview] = useState<VercelOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

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
            Where the studio and the marketplace are deployed. Read-only — the console reports, it
            never deploys.
          </p>
        </div>
        {overview ? (
          <Chip tone={overview.connected ? "ok" : "muted"}>
            {overview.connected ? "connected" : "not connected"}
          </Chip>
        ) : null}
      </header>

      {overview?.error || error ? (
        <div className="border-destructive/35 bg-destructive/10 text-destructive flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">{overview?.error ?? error}</p>
        </div>
      ) : null}

      <Card>
        <CardHeading
          title="Access token"
          hint="A Vercel token with read access to the two projects. Stored in apps/play/.env.local, which is gitignored — or set VERCEL_TOKEN in your shell to override it without writing anything."
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
                : overview?.tokenSource === "file"
                  ? "A token is stored in apps/play/.env.local."
                  : "Create one at vercel.com/account/tokens."
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
              variant="primary"
              onClick={() => void save(token)}
              busy={saving}
              disabled={!token}
            >
              {overview?.connected ? "Replace token" : "Connect"}
            </Button>
            {overview?.connected && overview.tokenSource === "file" ? (
              <Button variant="ghost" onClick={() => void save(null)} busy={saving}>
                Disconnect
              </Button>
            ) : null}
            {overview?.tokenSource ? (
              <span className="text-muted-foreground text-xs">
                reading from {overview.tokenSource === "environment" ? "VERCEL_TOKEN" : "apps/play/.env.local"}
              </span>
            ) : null}
          </div>
        </div>
      </Card>

      {overview?.connected
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
                  {project.prodUrl ? (
                    <a
                      href={project.prodUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground mt-4 inline-flex items-center gap-1.5 font-mono text-xs underline underline-offset-4"
                    >
                      {project.prodUrl.replace("https://", "")}
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  ) : null}

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
                            {variable.value ?? "— sensitive, not returned"}
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
            Comparing the table above with{" "}
            <span className="font-mono">Frontends → Env variables</span> is how that is caught —
            the two should agree for the backend you mean.
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
