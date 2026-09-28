'use client';

import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';

/** A read that failed, with the API's own sentence for why. */
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mt-8 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="text-sm font-medium">The API refused that</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            <Loader2Icon />
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
