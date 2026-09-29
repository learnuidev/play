import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A sentence with `code` and **emphasis** in it, drawn as such.
 *
 * The step details are written as prose that names files, commands and stages —
 * "`cdk synth` refuses if a path root is unclaimed", "`infra/config/play-<stage>.json`"
 * — and until this existed they arrived in the browser as literal backticks and
 * asterisks. Rendering them is the difference between a sentence somebody reads
 * and one they decode.
 *
 * Deliberately not a Markdown library. Two markers, one line, no links, no
 * lists, no HTML: this app's prose is short enough that a regex and a `map` are
 * the whole of it, and a dependency that can render arbitrary HTML from a string
 * is a liability a control panel has no use for.
 */

const PATTERN = /(`[^`]+`|\*\*[^*]+\*\*)/g;

export function InlineProse({ text, className }: { text: string; className?: string }) {
  const parts = text.split(PATTERN).filter((part) => part !== "");

  return (
    <span className={className}>
      {parts.map((part, index): ReactNode => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code
              key={index}
              className="bg-foreground/8 text-foreground/85 rounded px-1 py-0.5 font-mono text-xs"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong key={index} className="text-foreground/90 font-medium">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
}

/**
 * The same thing as a block, for a paragraph rather than a caption.
 *
 * Separate from `InlineProse` only so the call sites read as what they are: one
 * is a `span` inside a heading, the other is a `p` of its own.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("leading-relaxed", className)}>
      <InlineProse text={text} />
    </p>
  );
}
