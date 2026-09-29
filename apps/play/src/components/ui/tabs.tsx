"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A tab strip, in the same voice as the rail.
 *
 * The page is the same page — a backend, in an environment — and the tabs are
 * three views of it, so the strip reads as a caption under the title rather than
 * as navigation. Only the *content* below changes, which is why switching one is
 * instant and never loses the pickers above it.
 */

export interface TabDefinition<T extends string> {
  id: T;
  label: string;
  /** One line under the strip, in the environment's own words. */
  hint?: string;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  children,
}: {
  tabs: readonly TabDefinition<T>[];
  value: T;
  onChange: (id: T) => void;
  children?: ReactNode;
}) {
  const active = tabs.find((tab) => tab.id === value);

  return (
    <div className="flex flex-col gap-5">
      <div className="border-border/40 flex flex-wrap items-center gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={tab.id === value ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors",
              tab.id === value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
        {children ? <div className="ml-auto pb-1.5">{children}</div> : null}
      </div>

      {active?.hint ? (
        <p className="text-muted-foreground -mt-2 text-xs leading-relaxed">{active.hint}</p>
      ) : null}
    </div>
  );
}
