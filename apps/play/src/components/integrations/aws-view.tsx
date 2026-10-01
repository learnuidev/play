"use client";

import { CloudIcon, ShieldCheckIcon } from "lucide-react";

import { useShell } from "@/components/console/state";
import { Card, CardHeading } from "@/components/ui/card";
import { Chip, Dot } from "@/components/ui/chip";

/**
 * AWS, as this console sees it: who it is acting as, and what is deployed.
 *
 * Every other page here is downstream of one question — *which account, as
 * which identity?* — and this is where that answer lives. The profile is worth
 * showing with its source, because `scripts/api-config.env` supplies it when
 * `AWS_PROFILE` does not, and "which profile am I actually using" is the first
 * thing to check when a deploy fails with an authorization error that names
 * nothing.
 *
 * The console only ever *reads* AWS. Every call in `server/aws.ts` is a
 * `describe`, a `list` or a `get`; the writes are all in `infra/` and reachable
 * only through a deploy or one of its scripts.
 */
export function AwsView() {
  const { state } = useShell();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">AWS</h1>
        <p className="text-muted-foreground text-sm">
          The account the console acts on behalf of, read-only.
        </p>
      </header>

      <Card>
        <CardHeading
          title="Identity"
          hint="Read once, and re-read every thirty seconds — a stale SSO session is the most common reason a page here goes quiet."
          action={
            <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 font-mono text-xs">
              <ShieldCheckIcon className="size-3.5" />
              {state?.identity ? "resolved" : "unresolved"}
            </span>
          }
        />

        {state?.identityError ? (
          <p className="text-destructive mt-5 text-sm">{state.identityError}</p>
        ) : state?.identity ? (
          <div className="mt-5 flex flex-col">
            <Row label="Account" value={state.identity.account} />
            <Row label="Region" value={state.region} />
            <Row label="Profile" value={state.profile} />
            <Row label="Profile from" value={state.profileSource} />
            <Row label="Caller" value={state.identity.arn} />
            <Row label="User id" value={state.identity.userId} />
          </div>
        ) : (
          <p className="text-muted-foreground mt-5 text-xs">Reading credentials…</p>
        )}
      </Card>

      <Card>
        <CardHeading
          title="What is deployed"
          hint="The root stacks, per environment. A nested stack inside PlayApiStack is CDK's own division of the routes and is not shown."
        />

        <div className="mt-5 flex flex-col gap-6">
          {(state?.environments ?? []).map((environment) => (
            <div key={environment.stage} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-3 pb-3">
                <span className="font-mono text-sm font-semibold">{environment.stage}</span>
                <Chip tone={environment.deployed ? "ok" : environment.partial ? "warn" : "muted"}>
                  {environment.deployed
                    ? "complete"
                    : environment.partial
                      ? "partial"
                      : "not deployed"}
                </Chip>
                <span className="text-muted-foreground text-xs">
                  {environment.ownsEverything ? "creates its own resources" : "imports its resources"}
                </span>
                {environment.apiUrl ? (
                  <span className="text-muted-foreground ml-auto truncate font-mono text-xs">
                    {environment.apiUrl}
                  </span>
                ) : null}
              </div>

              {environment.stacks.map((stack) => (
                <div
                  key={stack.name}
                  className="border-border/40 flex items-center gap-3 border-t py-2 text-xs"
                >
                  <Dot tone={stack.healthy ? "ok" : stack.status === "—" ? "muted" : "warn"} />
                  <span className="font-mono">{stack.name}</span>
                  <span className="text-muted-foreground ml-auto font-mono">{stack.status}</span>
                </div>
              ))}
            </div>
          ))}
          {(state?.environments ?? []).length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No environments on disk. The Backends page writes one when you deploy a new stage.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeading title="How the console reaches it" />
        <div className="text-muted-foreground mt-4 flex flex-col gap-2 text-xs leading-relaxed">
          <p className="flex gap-2.5">
            <CloudIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Every call shells out to the <span className="font-mono">aws</span> CLI with the
              profile above, because the CLI is already configured here and a second credential path
              is a second thing to go stale. Nothing here writes: a deploy and its scripts are the
              only things in this repository that change AWS.
            </span>
          </p>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/40 flex flex-wrap items-baseline gap-3 border-t py-2.5 text-xs first:border-t-0">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <code className="min-w-0 flex-1 break-all font-mono">{value}</code>
    </div>
  );
}
