'use client';

import { CheckCircle2Icon, UsersIcon } from 'lucide-react';
import { SpaceCard } from '@learning/components/space/space-card';
import type { CatalogCourse } from '@play/types';

/**
 * One course on the marketplace's front page.
 *
 * The card itself is the studio's — same cover, same accent colour, same
 * calendar line — because a course looks like a course in both apps. What the
 * marketplace adds underneath is what a reader deciding whether to register
 * wants to know: how much of it there is, and how many people are already in.
 *
 * The link goes to the marketplace's own course page, which is the one thing the
 * two listings do not share.
 */
export function CourseCard({
  course,
  enrolled = false,
}: {
  course: CatalogCourse;
  /** Whether the reader is already taking it. */
  enrolled?: boolean;
}) {
  return (
    <SpaceCard
      href={`/courses/${course.spaceId}`}
      space={course}
      // The catalog already carries a signed cover URL, so the card does not ask
      // the thumbnail endpoint for one — it wants a token, and the people
      // reading this page have not signed in.
      coverUrl={course.thumbnailUrl}
      footer={
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'} · {course.sectionCount}{' '}
            section{course.sectionCount === 1 ? '' : 's'}
          </span>

          {enrolled ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2Icon className="size-3.5" />
              Enrolled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <UsersIcon className="size-3.5" />
              {course.studentCount}
            </span>
          )}
        </div>
      }
    />
  );
}
