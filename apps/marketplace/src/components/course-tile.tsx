'use client';

import Link from 'next/link';
import { CheckCircle2Icon, PlayCircleIcon } from 'lucide-react';
import { spaceAccentColor } from '@learning/components/space/space-avatar';
import { formatPrice, isPaid } from '@ui/lib/utils';
import type { CatalogCourse } from '@play/types';

/**
 * One course on the marketplace, as a tile.
 *
 * Not the studio's card, though both draw a course: a creator's list is a
 * management surface — covers, badges, how the thing runs — while this is a
 * storefront, where the picture is the invitation and everything else is one
 * quiet line under the name. What the two still share is the course itself:
 * the same cover, the same accent colour derived from the same id.
 *
 * The whole tile is the link, and the picture grows a little under the pointer,
 * which is the only movement on the page.
 */
export function CourseTile({
  course,
  enrolled = false,
}: {
  course: CatalogCourse;
  /** Whether the reader is already taking it. */
  enrolled?: boolean;
}) {
  const accent = spaceAccentColor(course);

  return (
    <Link
      href={`/courses/${course.spaceId}`}
      className="group flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card transition-shadow duration-300 hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/20"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {course.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.thumbnailUrl}
            alt=""
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-5xl font-semibold text-white/90 transition-transform duration-500 group-hover:scale-105"
            style={{ background: `linear-gradient(140deg, ${accent} 0%, ${accent}80 100%)` }}
          >
            {course.title.trim()[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="truncate text-xs text-muted-foreground">{course.organizationName}</p>

        <h3 className="mt-1.5 line-clamp-2 text-base font-semibold tracking-tight">
          {course.title}
        </h3>

        {course.description && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {course.description}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <PlayCircleIcon className="size-3.5" />
            {course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'}
          </span>

          {enrolled ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2Icon className="size-3.5" />
              Enrolled
            </span>
          ) : (
            <span className="flex items-baseline gap-3">
              <span className="tabular-nums">
                {course.studentCount} learning
              </span>
              {/* The price is the last thing on the tile rather than a badge over
                  the cover: what a course is called and what it covers is the
                  pitch, and what it costs is the answer to the question the pitch
                  creates. A free course says so — a blank where a price goes reads
                  as a price nobody has set. */}
              {isPaid(course) ? (
                <span className="font-semibold text-foreground">
                  {formatPrice(course.priceCents ?? 0, course.currency)}
                </span>
              ) : (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">Free</span>
              )}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
