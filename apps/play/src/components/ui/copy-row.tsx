"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * A value you are meant to paste somewhere else.
 *
 * There are two of these on the deploy page — the API URL and the pool — and
 * two more in Settings, where they are the values Google has to be told. They
 * exist because the alternative is selecting a monospace string out of a
 * paragraph, which is the step where people introduce a typo that fails at the
 * next sign-in instead of here.
 */
export function CopyRow({
  label,
  value,
  labelClassName = "w-40",
}: {
  label: string;
  value: string;
  /**
   * The label column's width. "API" and "Authorized JavaScript origins" want
   * different amounts of room, and a wrapped label beside a one-line value
   * reads as a mistake rather than as a long name.
   */
  labelClassName?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Refused; the value is selectable.
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className={cn("text-muted-foreground shrink-0 text-xs", labelClassName)}>{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
        {value}
      </code>
      <IconButton onClick={copy} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
        {copied ? <CheckIcon className="text-ok size-3.5" /> : <CopyIcon className="size-3.5" />}
      </IconButton>
    </div>
  );
}
