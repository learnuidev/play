import type { ReactNode } from 'react';
import { cn } from '@ui/lib/utils';

/**
 * The content card every page in the community shell renders inside: a titled
 * panel on the muted canvas behind it, mirroring the layout the app is modelled
 * on.
 *
 * A soft edge and a generous one: a hairline rather than a border, a large
 * radius, and enough padding that the title has air around it. The page is a
 * document you are reading, and the card is the page's own frame rather than a
 * box drawn around every concern.
 */
export function PageCard({
  title,
  description,
  actions,
  children,
  contentClassName,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card text-card-foreground shadow-sm">
      <header className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-5">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn('px-6 pb-6', contentClassName)}>{children}</div>
    </section>
  );
}

/**
 * The heading above a block of a page: a sentence, set in the same voice as the
 * title above it, with an optional action on the other side.
 *
 * Sentence case and no tracking, because the structure of these pages is carried
 * by space and hairlines rather than by small capitals — a wall of uppercase
 * micro-labels reads as a form to fill in.
 */
export function BlockLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

/** Centred icon + heading + explanation + action, as an empty panel state. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border/70 px-6 py-20 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        {icon}
      </div>
      <div className="max-w-md">
        <p className="text-lg font-medium tracking-tight">{title}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
