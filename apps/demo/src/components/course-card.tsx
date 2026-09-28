'use client';

import Link from 'next/link';
import { GraduationCapIcon, UsersIcon } from 'lucide-react';
import { Badge } from '@ui/components/ui/badge';
import { spaceAccentColor } from '@learning/components/space/space-avatar';
import type { CatalogCourse } from '@play/types';

/**
 * One course, as this app draws it.
 *
 * Not Play's course card: that one asks for a signed cover URL through Play's
 * own authenticated client, and this app is not signed in to Play — it holds an
 * OAuth token, and the catalog already hands it a signed cover URL when a course
 * has one. So the card is written here, in the shared design vocabulary, which
 * is also the honest picture of what building on the API costs: a card.
 */
export function CourseCard({ course }: { course: CatalogCourse }) {
  // The same accent the studio and the marketplace derive, from the same
  // helper: a course's colour is one of the few things that is the course's own,
  // and it should not be a different shade in the app that reads it over OAuth.
  const accent = spaceAccentColor(course);

  return (
    <Link
      href={`/courses/${course.spaceId}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card text-card-foreground transition-colors hover:border-ring/50"
    >
      <div
        className="relative aspect-video w-full overflow-hidden bg-muted"
        style={accent ? { backgroundColor: `${accent}1a` } : undefined}
      >
        {course.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.thumbnailUrl}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div
            className="flex size-full items-center justify-center"
            style={accent ? { color: accent } : undefined}
          >
            <GraduationCapIcon className="size-8 opacity-60" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{course.title}</p>
        {course.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {course.description}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Badge variant="secondary" className="font-normal">
            {course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'}
          </Badge>
          {course.studentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <UsersIcon className="size-3" />
              {course.studentCount}
            </span>
          )}
          <span className="ml-auto truncate text-xs text-muted-foreground">
            {course.organizationName}
          </span>
        </div>
      </div>
    </Link>
  );
}
