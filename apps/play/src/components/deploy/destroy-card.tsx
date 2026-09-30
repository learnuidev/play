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
 * is not: it destroys the four CloudFormation stacks, deletes everything they
 * stood on — the tables, both buckets and the video in them, the distribution,
 * the user pool with every account in it, every log group and this stage's
 * signing key — and removes `infra/config/play-<stage>.json`, which is what takes
 * the environment out of this console. What it can undo is nothing. So it is
 * built the way `infra/scripts/teardown-legacy-stack.sh` is built: the
 * consequences are stated *before* the control, and the control asks for the
 * stage's name rather than a click. A button one slip away from the Deploy button
 * above it would be a bad trade for the two seconds typing costs.
 *
 * Two things make a delete this broad safe to have on a page at all, and both are
 * said here because they are what somebody deciding whether to press it needs to
 * know: the run **refuses to start** if another stage's config names any of these
 * resources, and its own last step reads back whatever it could not take with it
 * and whatever is still pointed at where the environment was. The card describes
 * neither outcome in advance — the run does, from what is actually there.
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
        hint={`Destroys the four CloudFormation stacks — PlayDataStack-${stage}, PlayMediaStack-${stage}, PlayAuthStack-${stage} and PlayApiStack-${stage} — deletes the tables, both buckets, the CloudFront distribution, the user pool, the log groups and this stage's secrets, and removes infra/config/play-${stage}.json, which is what takes ${stage} out of this console.`}
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
            `**All of it goes, and none of it comes back.** Every stateful resource here is ` +
            `\`RemovalPolicy.RETAIN\`, so the destroy is only half of the work: the tables, both ` +
            `buckets and the video in them, the CloudFront distribution, the user pool with every ` +
            `account in it, every log group and this stage's signing key are deleted by the run's own ` +
            `steps, one by one. A redeploy of \`${stage}\` afterwards starts empty — the courses are ` +
            `gone, and everybody who had an account here makes another one. ` +
            (reading
              ? `Which of those exist is read as the run goes: the steps that find nothing are check ` +
                `marks, and the last one reports anything they could not take with them.`
              : environment === null
                ? `There is no config file for this environment, so there is nothing here to delete — ` +
                  `but a redeploy of \`${stage}\` would run against whatever AWS still holds under that name.`
                : environment.ownsEverything
                  ? `This environment **creates** everything it stands on — 27 tables named ` +
                    `\`play-${stage}-*\`, its buckets, its distribution and its pool — so all of that is ` +
                    `its own to delete, and the run's last step reports anything left over.`
                  : `This environment **imports** the tables, media and pool it stands on: the legacy ` +
                    `stack made them and this config is the only thing that names them. A delete takes ` +
                    `them too, because they are this environment's data however they were created — ` +
                    `unless a **second** stage's config names one of them, in which case the run refuses ` +
                    `before anything is destroyed.`)
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
                Destroy the stacks and delete the data
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
                  : "The stacks go, and the data with them."}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
