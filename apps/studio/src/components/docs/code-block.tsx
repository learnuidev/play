import { cn } from '@ui/lib/utils';
import { CopyButton } from '@/components/copy-button';

/**
 * A block of code, with the thing that makes it useful: a copy button.
 *
 * A reference is read by somebody who is about to paste one of these, so every
 * block is copyable rather than selectable. The label above it says what it is —
 * the response status, or `cURL` — because two unlabelled JSON blocks in a row
 * are a puzzle.
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
        'overflow-hidden rounded-2xl border border-border/60 bg-muted/40',
        className,
      )}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <CopyButton value={code} size="icon" className="size-7" />
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
