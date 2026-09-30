"use client";

import { useState } from "react";
import { TriangleAlertIcon, Trash2Icon, XIcon } from "lucide-react";

import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Prose } from "@/components/ui/prose";
import type { EnvironmentView } from "@/lib/types";

/**
 * Deleting an environment, and why it is the one control that asks for typing.
 *
 * Everything else in this console is reversible by pressing another button. This
 * is not: it destroys the four CloudFormation stacks and removes
 * `infra/config/play-<stage>.json`, and what it can undo is nothing. So it is
 * built the way `infra/scripts/teardown-legacy-stack.sh` is built — the
 * consequences are stated *before* the control, and the control asks for the
 * stage's name rather than a click. A button one slip away from the Deploy button
 * above it would be a bad trade for the two seconds typing costs.
 *
 * The card is deliberately not a warning banner. What it says first is what
 * **stays**: a destroy here deletes no data, because every stateful resource in
 * this app is `RemovalPolicy.RETAIN`. That fact is the difference between a
 * delete somebody can use to clean up after an experiment and one nobody dares
 * press — and the run's own last step reads back what was actually left, which is
 * the version worth trusting.
 */
export function DestroyCard({
  stage,
  environment,
  reading,
  running,
  onDestroy,
}: {
  stage: string;
  /** Null for a stage the repository has no config file for. */
  environment: EnvironmentView | null;
  /**
   * Before the first read, `environment` is null for *every* stage — and "there
   * is no config file here" is the alarming half of that, so the card says
   * nothing about ownership until it knows.
   */
  reading: boolean;
  /** A run — a deploy or a delete — is going against this environment. */
  running: boolean;
  /** Starts the destroy run, and answers with a refusal or null. */
  onDestroy: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim() === stage;

  const close = () => {
    setOpen(false);
    setTyped("");
    setError(null);
  };

  const destroy = async () => {
    setBusy(true);
    setError(null);
    const refusal = await onDestroy();
    setBusy(false);
    if (refusal) {
      setError(refusal);
      return;
    }
    // The run is going now; the checklist above is where it is watched from, and
    // this card has nothing left to offer until it finishes.
    close();
  };

  return (
    <Card className="border-destructive/25">
      <CardHeading
        title="Delete this environment"
        hint={`Destroys the four CloudFormation stacks — PlayDataStack-${stage}, PlayMediaStack-${stage}, PlayAuthStack-${stage} and PlayApiStack-${stage} — and removes infra/config/play-${stage}.json, which is what takes ${stage} out of this console.`}
        action={
          open ? (
            <IconButton onClick={close} title="Cancel" aria-label="Cancel">
              <XIcon className="size-3.5" />
            </IconButton>
          ) : null
        }
      />

      <div className="mt-4 flex flex-col gap-3">
        <Prose
          className="text-muted-foreground max-w-3xl text-xs"
          text={
            `**No data is deleted.** Every table, both buckets, the CloudFront distribution, the user pool ` +
            `and every log group are \`RemovalPolicy.RETAIN\`: the destroy leaves them in AWS and ` +
            `CloudFormation stops managing them. ` +
            (reading
              ? `How much that is depends on whether this environment creates or imports what it stands ` +
                `on — either way, the run's last step reads back what is actually there, and what a ` +
                `redeploy of \`${stage}\` will hit because of it.`
              : environment === null
                ? `There is no config file for this environment, so there is nothing here to destroy — ` +
                  `but a redeploy of \`${stage}\` would run against whatever AWS still holds under that name.`
                : environment.ownsEverything
                  ? `This environment **creates** everything it stands on, so what it leaves behind is its ` +
                    `own: 27 tables named \`play-${stage}-*\`, its buckets, its distribution and its pool. ` +
                    `The run's last step reads back what is actually there, and what a redeploy of ` +
                    `\`${stage}\` will hit because of it.`
                  : `This environment **imports** the tables, media and pool it stands on, so they were ` +
                    `never its to delete: nothing shared with another stage is touched, and neither is ` +
                    `anything the environment that owns them is doing. The run's last step reads back what ` +
                    `is actually there.`)
          }
        />

        {running ? (
          <p className="text-muted-foreground border-border/40 flex items-start gap-2.5 border-t pt-4 text-xs leading-relaxed">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              A run is going against this environment right now — the checklist above is it. Deleting is
              refused until it finishes or is stopped, because two runs against one set of stacks do not
              compose.
            </span>
          </p>
        ) : open ? (
          <div className="border-border/40 flex flex-col gap-3 border-t pt-4">
            <label className="flex flex-col gap-2 text-xs" htmlFor="destroy-confirm">
              <span className="text-muted-foreground">
                This cannot be undone from here. Type{" "}
                <span className="text-foreground font-mono">{stage}</span> to confirm:
              </span>
              <input
                id="destroy-confirm"
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                }}
                placeholder={stage}
                autoComplete="off"
                spellCheck={false}
                className="border-border/70 bg-background/60 focus-visible:ring-ring h-9 w-full max-w-xs rounded-full border px-4 font-mono text-sm focus-visible:ring-2 focus-visible:outline-none"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                busy={busy}
                disabled={!confirmed}
                onClick={() => void destroy()}
                icon={<Trash2Icon className="size-3.5" />}
              >
                Destroy the stacks and remove the config
              </Button>
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
            </div>

            {error ? <p className="text-destructive text-xs">{error}</p> : null}
          </div>
        ) : (
          <div className="border-border/40 flex flex-wrap items-center gap-3 border-t pt-4">
            <Button
              variant="danger"
              size="sm"
              disabled={reading || environment === null}
              onClick={() => setOpen(true)}
              icon={<Trash2Icon className="size-3.5" />}
            >
              Delete {stage}
            </Button>
            <span className="text-muted-foreground text-xs">
              {reading
                ? "Reading the environment…"
                : environment === null
                  ? "There is no config file for this environment, so there is nothing here to delete."
                  : "The stacks go. The data stays."}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
