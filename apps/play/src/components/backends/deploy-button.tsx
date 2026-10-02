"use client";

import { useCallback, useState } from "react";
import { RocketIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RunSummary } from "@/lib/types";

/**
 * Starting a deploy, and the small button a list row offers for it.
 *
 * ## Two buttons, one press
 *
 * A deploy can be started from a row on the list and from the header of an
 * environment's own page. They are the same `POST /api/deploy` with the same
 * plan, and what differs is only *weight*: a row on a list of environments
 * offers `Deploy` small and secondary, while the environment page offers the
 * full primary `Deploy <stage>` — that one from
 * `components/deploy/deploy-action.tsx`, because the deploy page's own card used
 * to carry it and the two had to look alike.
 *
 * The page's is driven by the page's `useDeploy`, so the Deployments tab draws
 * the run it starts. This hook is the same call without that: a stream for a run
 * nobody on this screen is watching.
 */

/**
 * The press, without a page to draw it on.
 *
 * A refusal is the server's own sentence, and the most likely one is the race
 * between two tabs — the server holds one run per environment — so it is
 * returned rather than swallowed: a control that does nothing and says nothing
 * is the worst of the three possible behaviours.
 */
/**
 * The row's Deploy: list weight, and the same press as the page's.
 *
 * Disabled rather than hidden while a run is going — the chip beside the name is
 * what says why — and the label follows the run, because "Deploying" over a
 * delete would be a lie about somebody's environment.
 */
export function DeployButton({
  stage,
  running,
  onStarted,
}: {
  stage: string;
  /** The run going against this stage right now, in either direction. */
  running: RunSummary | null;
  /** Told when a deploy was accepted, so the console re-reads what is running. */
  onStarted: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = running !== null;

  const start = useCallback(() => {
    void (async () => {
      setStarting(true);
      setError(null);
      try {
        const response = await fetch("/api/deploy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stage }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(body.error ?? `The deploy could not start (HTTP ${response.status}).`);
          return;
        }
        onStarted();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setStarting(false);
      }
    })();
  }, [stage, onStarted]);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        busy={starting}
        disabled={busy}
        onClick={start}
        icon={<RocketIcon className="size-3.5" />}
        title={
          busy
            ? `A ${running?.action === "destroy" ? "delete" : "deploy"} is already running against ${stage}`
            : `Deploy ${stage} — the same plan the Deployments tab runs`
        }
      >
        {running?.action === "destroy" ? "Deleting" : busy ? "Deploying" : "Deploy"}
      </Button>

      {error ? <span className="text-destructive max-w-64 text-right text-xs">{error}</span> : null}
    </span>
  );
}
