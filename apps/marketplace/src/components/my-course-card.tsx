'use client';

import { SpaceCard } from '@learning/components/space/space-card';
import type { Space, SpaceMemberRole } from '@play/types';

/** What each role means to the person wearing it, in the marketplace's words. */
const ROLE_LABELS: Record<SpaceMemberRole, string> = {
  STUDENT: 'Learning',
  ASSISTANT: 'Assistant',
  INSTRUCTOR: 'Instructor',
};

/**
 * One course in "my learning".
 *
 * The course is a `Space` here rather than a catalog course, because this list
 * comes from the reader's own memberships — which include courses they were
 * invited to and courses nobody listed. Its cover is read from the space's own
 * endpoint, which is why this card passes no cover URL: the reader is signed in.
 */
export function MyCourseCard({ space, role }: { space: Space; role: SpaceMemberRole }) {
  return (
    <SpaceCard
      href={`/courses/${space.spaceId}`}
      space={space}
      footer={
        <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>{ROLE_LABELS[role]}</span>
          <span className="font-medium text-foreground">Open course</span>
        </div>
      }
    />
  );
}
