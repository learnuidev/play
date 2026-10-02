"use client";

import { useCallback, useState } from "react";
import { RocketIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RunSummary } from "@/lib/types";

/**
 * Starting a deploy of one environment.
 *
 * **One component for two places** — the row on the list, and the header of the
 * environment's own page — and that is not tidiness: starting a deploy is the
 * console's one write to the plan, and two implementations of it would be two
 * answers to "what does this button say while a run is going" and to what
 * "already deploying" means. The two are the same press; the Deployments tab is
 * still where the checklist is read before a *first* one.
 *
 * The refusal a run produces is drawn under the button rather than swallowed: a
 * control that does nothing and says nothing is the worst of the three possible
 * behaviours, and the most likely refusal is the race between two tabs — the
 * server holds one run per environment.
 */
export function DeployButton({
  stage,
  running,
  onStarted,
  variant = "secondary",
  size = "sm",
}: {
  stage: string;
  /** The run going against this stage right now, in either direction. */
  running: RunSummary | null;
  /** Told when a deploy was accepted, so the console re-reads what is running. */
  onStarted: () => void;
  variant?: "secondary" | "primary";
  size?: "sm" | "md";
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = running !== null;

  const deploy = useCallback(async () => {
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
  }, [stage, onStarted]);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      {/* Disabled rather than hidden while a run is going — the chip beside the
          name is what says why — and the label follows the run, because
          "Deploying" over a delete would be a lie about somebody's environment. */}
      <Button
        variant={variant}
        size={size}
        busy={starting}
        disabled={busy}
        onClick={() => void deploy()}
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
