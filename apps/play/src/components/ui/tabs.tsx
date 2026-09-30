"use client";

import type { ReactNode } from "react";
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

/**
 * Which tab a page is showing, kept in the query string.
 *
 * The strip is instant because only what is below it changes — but "which view am
 * I looking at" is worth surviving a reload, a back button and a copy-paste of the
 * address bar, and a query parameter is the only place that survives all three.
 * `?tab=logs` is a link somebody can send, and it is the same link they were
 * looking at.
 *
 * ## Why `replace` rather than `push`
 *
 * Switching tabs twice would otherwise put two entries in the history, and the
 * back button would then walk back through the tabs instead of leaving the page —
 * which is the one thing the path-based addressing of these pages was for. So a
 * tab change **rewrites** the current entry: the URL always says what is on
 * screen, and back still goes where it went before.
 *
 * `scroll: false` is not a detail either: `router.replace` scrolls to the top by
 * default, and a strip whose tabs are halfway down a long page would jump under
 * the pointer that clicked it.
 *
 * An unreadable or missing `?tab=` is the first tab rather than an error, which is
 * what makes the parameter safe to leave out — every link written before tabs had
 * one still works.
 */
export function useTabParam<T extends string>(
  tabs: readonly TabDefinition<T>[],
  param = "tab",
): { tab: T; select: (id: T) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const wanted = searchParams.get(param);
  const match = tabs.find((tab) => tab.id === wanted);
  const tab = match ? match.id : tabs[0].id;

  const select = useCallback(
    (id: T) => {
      const params = new URLSearchParams(searchParams);
      params.set(param, id);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [param, pathname, router, searchParams],
  );

  return { tab, select };
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
