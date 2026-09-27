'use client';

import { PlusIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { BlockLabel } from '@/components/shell/page-card';
import { ContentOutline } from '@learning/components/content/content-outline';
import { LearningRoutesProvider } from '@learning/lib/learning-routes';
import { SectionDialog } from '@learning/components/content/section-dialog';
import type { SectionWithContents } from '@play/types';
import { studioLearningRoutes } from '@/lib/routes';

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
        // The outline draws a link per lesson, and the classroom it links into
        // is shared with the marketplace — so which URLs those are is stated
        // here rather than assumed by the outline itself.
        <LearningRoutesProvider routes={studioLearningRoutes(orgId)}>
          <ContentOutline
            orgId={orgId}
            spaceId={spaceId}
            sections={sections}
            truncated={truncated}
            canEdit={canEdit}
          />
        </LearningRoutesProvider>
      )}
    </section>
  );
}
