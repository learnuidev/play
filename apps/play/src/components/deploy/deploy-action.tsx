"use client";

import { RocketIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The Deploy button — the one control that starts a backend plan.
 *
 * **Presentation only**, deliberately: it is handed the action, so the deploy
 * page's own card can drive it from the run it is streaming and a page that
 * merely starts one can drive it from a `POST`. What it owns is the part that
 * must not differ between the two places it appears: the primary variant, the
 * rocket, and the label that names the environment it would deploy. A second
 * copy of that markup is how one screen ends up offering a smaller, greyer
 * version of the same button than another.
 */
export function DeployAction({
  stage,
  onDeploy,
  busy = false,
  disabled = false,
  title,
}: {
  stage: string;
  onDeploy: () => void;
  /** A run is being started by this press. */
  busy?: boolean;
  /** A run is already going, so there is nothing to start. */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Button
      variant="primary"
      onClick={onDeploy}
      disabled={disabled}
      busy={busy}
      icon={<RocketIcon className="size-4" />}
      title={title}
    >
      Deploy {stage}
    </Button>
  );
}
