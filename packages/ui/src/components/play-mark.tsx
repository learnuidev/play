import { GraduationCapIcon } from 'lucide-react';
import { cn } from '@ui/lib/utils';

/**
 * Play's mark, on a screen that has no bar to carry one.
 *
 * Both apps put the same thing in their own header — a graduation cap beside the
 * word Play — and this is that cap, drawn the way a screen with nothing else on
 * it needs it: a filled tile rather than a line drawing, because a lone outline
 * icon over a form reads as decoration and a tile reads as a brand.
 *
 * It lives here rather than in either screen because two of them draw it: the
 * shared sign-in screen, and the invitation page that stands in front of it. The
 * size, the corner and the room beneath it are the composition's business, so
 * `className` is spread over the tile and the caller spaces it from what follows.
 */
export function PlayMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground',
        className,
      )}
    >
      <GraduationCapIcon className="size-5" aria-hidden="true" />
    </span>
  );
}
