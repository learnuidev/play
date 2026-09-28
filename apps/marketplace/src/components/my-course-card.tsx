'use client';

import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';
import { SpaceCard } from '@learning/components/space/space-card';
import { CourseProgress } from '@/components/course-progress';
import type { CourseProgress as CourseProgressData, Space, SpaceMemberRole } from '@play/types';

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
 * to a course wants. Both are answered by the API, which is the only party that
 * knows what this reader has finished — until it answers, and for a course with
 * nothing published, that link opens the course itself rather than a lesson
 * nobody meant.
 *
 * Until it answers there is no percentage either, and none is invented: a card
 * that opened by claiming "0%" about a course somebody is halfway through would
 * be lying about the one thing the card is for.
 */
export function MyCourseCard({
  space,
  role,
  progress,
}: {
  space: Space;
  role: SpaceMemberRole;
  /** How far this reader has got, when the API has said. */
  progress?: CourseProgressData;
}) {
  const coursePath = `/courses/${space.spaceId}`;
  const lessonPath = progress?.nextContentId
    ? `${coursePath}/lessons/${progress.nextContentId}`
    : coursePath;

  return (
    <SpaceCard
      href={coursePath}
      space={space}
      footer={
        <div className="grid gap-2.5 border-t pt-3 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span>{ROLE_LABELS[role]}</span>

            <Link
              href={lessonPath}
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
            >
              Continue learning
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>

          {progress && (
            <CourseProgress
              completedCount={progress.completedCount}
              lessonCount={progress.lessonCount}
            />
          )}
        </div>
      }
    />
  );
}
