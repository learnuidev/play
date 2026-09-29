"use client";

import { useMemo } from "react";

import { useShell } from "@/components/console/state";
import { Picker } from "@/components/ui/picker";

/**
 * The environment a frontend is started against.
 *
 * The shell's stage rather than a copy of it, because "which environment" is one
 * question the whole console shares: the rail, the deploy page and this picker
 * are the same answer, so a card that reads `staging` and a deploy that runs
 * against `staging` cannot disagree. The hint is what the dropdown can say that
 * the stage name cannot — whether there is an API to point the app at.
 */
export function EnvironmentPicker({ className }: { className?: string }) {
  const { stage, stages, state, setStage } = useShell();

  const options = useMemo(
    () =>
      (stages.length ? stages : ["dev"]).map((candidate) => {
        const view = state?.environments.find((item) => item.stage === candidate);
        return {
          value: candidate,
          label: candidate,
          hint: view?.apiUrl ? "deployed" : "no API yet",
        };
      }),
    [stages, state],
  );

  return (
    <Picker
      label="Environment"
      value={stage}
      onChange={setStage}
      options={options}
      className={className}
    />
  );
}
