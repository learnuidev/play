'use client';

import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';
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
 *
 * The two destinations are split, and the split is the point: the cover opens
 * the course page, where somebody decides what a course is, and "continue
 * learning" opens the lesson they are up to, which is what somebody coming back
 * to a course wants. The lesson is resolved by the API, which is the only party
 * that knows what this reader has finished — until it answers, and for a course
 * with nothing published, that link opens the course itself rather than a lesson
 * nobody meant.
 */
export function MyCourseCard({
  space,
  role,
  nextContentId,
}: {
  space: Space;
  role: SpaceMemberRole;
  /** The first lesson of this course the reader has not finished. */
  nextContentId?: string;
}) {
  const coursePath = `/courses/${space.spaceId}`;

  return (
    <SpaceCard
      href={coursePath}
      space={space}
      footer={
        <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>{ROLE_LABELS[role]}</span>
          <Link
            href={nextContentId ? `${coursePath}/lessons/${nextContentId}` : coursePath}
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            Continue learning
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
      }
    />
  );
}
