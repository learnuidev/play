import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The content card every page in the community shell renders inside: a titled
 * panel on the muted canvas behind it, mirroring the layout the app is modelled
 * on.
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
    <section className="overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm">
      <header className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn('p-5', contentClassName)}>{children}</div>
    </section>
  );
}

/**
 * The quiet label above a block of a page: small, uppercase, tracked.
 *
 * Used by the pages that are documents rather than panels — a course and one of
 * its lessons — where structure is carried by space and hairlines instead of by
 * a card drawn around every concern.
 */
export function BlockLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {children}
      </h2>
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
        'flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-6 py-16 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full border bg-muted/40">
        {icon}
      </div>
      <div className="max-w-md">
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
