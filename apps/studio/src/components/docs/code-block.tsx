import { cn } from '@ui/lib/utils';
import { CopyButton } from '@/components/copy-button';

/**
 * A block of code, with the thing that makes it useful: a copy button.
 *
 * A reference is read by somebody who is about to paste one of these, so every
 * block is copyable rather than selectable. The label above it says what it is —
 * the response status, or `cURL` — because two unlabelled JSON blocks in a row
 * are a puzzle.
 *
 * `min-w-0` and the one on the `<pre>` are what keep a long command from taking
 * the page's width with it. A block of code is the widest thing on this page by
 * definition — a cURL with a signed URL in it is hundreds of characters — and a
 * grid or flex item is sized by its content's minimum unless it is told
 * otherwise, so without these a single long line makes the whole reference
 * scroll sideways instead of the one line scrolling inside its own box.
 */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        'min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-muted/40',
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <CopyButton value={code} size="icon" className="size-7" />
      </figcaption>
      <pre className="min-w-0 overflow-x-auto px-4 py-3.5 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
