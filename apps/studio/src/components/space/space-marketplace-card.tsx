'use client';

import { useState } from 'react';
import { ExternalLinkIcon, EyeIcon, EyeOffIcon, Loader2Icon, StoreIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Space } from '@play/types';
import { useUpdateSpace } from '@api/modules/space/space.queries';
import { Button } from '@ui/components/ui/button';
import { cn } from '@ui/lib/utils';
import { BlockLabel } from '@/components/shell/page-card';

/**
 * Where the marketplace lives.
 *
 * A link to somewhere else is configuration, not a route: the two apps are
 * deployed separately and the studio has no way to derive the marketplace's
 * address from its own. Unset means this deployment has no marketplace, and the
 * card says what publishing would do without pretending to offer it.
 */
const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? '').replace(/\/+$/, '');

/** The single URL that means "every listed course". */
const MARKETPLACE_CATALOG_URL = MARKETPLACE_URL ? `${MARKETPLACE_URL}/courses` : '';

/**
 * Publishing a course, and unpublishing it again.
 *
 * Its own card with its own save, rather than another field on the details
 * form: what a course is called is edited while writing it, and whether strangers
 * may find it is a decision taken once, deliberately — the sort of thing that
 * should not be sitting one stray click away from a title field.
 *
 * Listing a course is what puts it in the marketplace catalog, where anybody —
 * signed in or not — can read what it is, see its syllabus, and register for it.
 */
export function SpaceMarketplaceCard({ space, canEdit }: { space: Space; canEdit: boolean }) {
  const update = useUpdateSpace(space.spaceId);
  const [listed, setListed] = useState(Boolean(space.listed));

  // The course can change under this card — somebody else's publish arriving
  // with the list — so the switch follows the course rather than the click.
  const published = Boolean(space.listed);

  async function publish(next: boolean) {
    setListed(next);
    try {
      await update.mutateAsync({ listed: next });
      toast.success(next ? 'Course published to the marketplace' : 'Course removed from the marketplace');
    } catch (err) {
      // Put the switch back where the server still has it.
      setListed(!next);
      toast.error(err instanceof Error ? err.message : 'Could not change who can find this course');
    }
  }

  return (
    <section className="grid gap-3">
      <BlockLabel
        action={
          published && MARKETPLACE_CATALOG_URL ? (
            <a
              href={`${MARKETPLACE_CATALOG_URL}/${space.spaceId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLinkIcon className="size-3.5" />
              View in marketplace
            </a>
          ) : undefined
        }
      >
        Marketplace
      </BlockLabel>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl',
              published ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
            )}
          >
            {published ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
          </span>

          <div className="min-w-0">
            <p className="text-sm font-medium">
              {published ? 'Listed in the marketplace' : 'Only your community can see this course'}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {published
                ? 'Anyone can find this course, read its syllabus and register for it. Lessons stay members-only.'
                : 'Publishing lists this course in the marketplace catalog, where anybody can find it and register.'}
            </p>
          </div>
        </div>

        <Button
          variant={published ? 'outline' : 'default'}
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={!canEdit || update.isPending}
          onClick={() => void publish(!listed)}
        >
          {update.isPending ? (
            <Loader2Icon className="animate-spin" />
          ) : published ? (
            <EyeOffIcon />
          ) : (
            <StoreIcon />
          )}
          {published ? 'Unlist' : 'Publish'}
        </Button>
      </div>

      {!MARKETPLACE_URL && (
        <p className="text-xs text-muted-foreground">
          This deployment has no marketplace configured, so a listed course has no catalog to
          appear in yet. Set <code>NEXT_PUBLIC_MARKETPLACE_URL</code> to point at one.
        </p>
      )}
    </section>
  );
}
