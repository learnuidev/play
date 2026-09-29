"use client";

import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * The one dropdown in the console.
 *
 * A backend and a frontend are both "a thing, in an environment", and both pages
 * open with the same two questions — *which one*, and *against what*. So it is
 * the same control twice, at the same size, in the same place: a native
 * `<select>`, because it is a choice from a known list and the native one
 * already works with a keyboard, a screen reader and a phone.
 */
export function Picker<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  /** `hint` is drawn under the name — a port, a status, a warning. */
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="relative flex items-center">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          className="border-border/70 bg-background/60 focus-visible:ring-ring h-11 w-full appearance-none rounded-2xl border pr-9 pl-3.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.hint ? `${option.label} — ${option.hint}` : option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute right-3 size-4"
        />
      </span>
    </label>
  );
}
