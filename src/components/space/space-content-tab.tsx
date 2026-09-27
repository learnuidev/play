'use client';

import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BlockLabel } from '@/components/shell/page-card';
import { ContentOutline } from '@/components/content/content-outline';
import { SectionDialog } from '@/components/content/section-dialog';
import type { SectionWithContents } from '@/types';

/**
 * A course's content: its sections in reading order, each holding its lessons.
 *
 * This is what the space page used to be on its own, moved into the first tab
 * beside it rather than rewritten — the outline is the course, and everything
 * the other tabs do is about the people taking it.
 */
export function SpaceContentTab({
  orgId,
  spaceId,
  sections,
  truncated,
  loading,
  canEdit,
}: {
  orgId: string;
  spaceId: string;
  sections: SectionWithContents[];
  truncated: boolean;
  loading: boolean;
  canEdit: boolean;
}) {
  return (
    <section className="grid gap-3">
      {/* Nothing published means nothing to label: the block below says so
          itself, and the button that starts the course lives in it. */}
      {(loading || sections.length > 0) && (
        <BlockLabel
          action={
            canEdit && sections.length > 0 ? (
              <SectionDialog
                spaceId={spaceId}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-2 h-7 gap-1 px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    <PlusIcon />
                    New section
                  </Button>
                }
              />
            ) : undefined
          }
        >
          Content
        </BlockLabel>
      )}

      {loading ? (
        <div className="grid gap-3 py-2">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      ) : (
        <ContentOutline
          orgId={orgId}
          spaceId={spaceId}
          sections={sections}
          truncated={truncated}
          canEdit={canEdit}
        />
      )}
    </section>
  );
}
