'use client';

import Link from 'next/link';
import { BookmarkIcon, PlayCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { Skeleton } from '@ui/components/ui/skeleton';
import { cn } from '@ui/lib/utils';
import type { ApiFavouriteLesson } from '@play/types';

/**
 * What this person has saved, at the foot of the classroom.
 *
 * The list half of `learning:read`, and the only place in this app that shows
 * lessons *out of their course*: a saved lesson is somebody's own shelf, and
 * reading it means the classroom has to answer "where was I" without a course id
 * in the URL. Each row carries the course it belongs to and the lesson's place in
 * it, which is what `spaceTitle` and `position` are for — the API resolves the
 * course in the same batch as the lesson so a list like this does not have to
 * fetch one per row.
 *
 * Clicking a row that belongs to the course being read moves the panel above it
 * rather than navigating: the classroom is already open, and a page load to show
 * the lesson somebody just clicked would be a second read of everything on the
 * page. A row from another course is a link, because this app has no classroom
 * open for that one.
 */
export function SavedLessons({
  lessons,
  loading,
  error,
  currentId,
  spaceId,
  onSelect,
}: {
  lessons: ApiFavouriteLesson[];
  loading: boolean;
  /** The scope refusal, when the credential does not hold `learning:read`. */
  error?: string;
  currentId: string | undefined;
  /** The course already on screen, whose lessons can be opened in place. */
  spaceId: string;
  onSelect: (contentId: string) => void;
}) {
  if (loading) {
    return (
      <section className="mt-10">
        <Skeleton className="h-5 w-40" />
        <div className="mt-3 grid gap-2">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-10 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Your saved lessons could not be read</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{error}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              This list needs <span className="font-mono">learning:read</span>, which is a separate
              permission from marking progress — seeing what somebody saved is not the same grant as
              changing it.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (lessons.length === 0) {
    return (
      <section className="mt-10 rounded-2xl border border-dashed border-border/70 px-5 py-6">
        <div className="flex items-start gap-3">
          <BookmarkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Nothing saved yet</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Press <strong>Save</strong> on a lesson and it appears here — read back from Play with
              <span className="font-mono"> GET /v1/me/learning</span>, not kept in this browser.
              That is the difference an OAuth token makes: the shelf travels with the person, to
              whatever app they let in.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold tracking-tight">
        Saved lessons
        <span className="ml-2 font-normal text-muted-foreground">{lessons.length}</span>
      </h2>
      <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
        Yours, read with <span className="font-mono">learning:read</span> — across every course, not
        only this one.
      </p>

      <ul className="mt-3 grid gap-2">
        {lessons.map((lesson) => {
          const sameCourse = lesson.spaceId === spaceId;
          const current = lesson.contentId === currentId;

          const row = (
            <>
              <PlayCircleIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{lesson.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {lesson.spaceTitle} · lesson {lesson.position}
                  {lesson.hasVideo ? '' : ' · no video'}
                </span>
              </span>
            </>
          );

          const className = cn(
            'flex w-full flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
            current ? 'border-ring/60 bg-muted/50' : 'border-border/60 hover:bg-muted/40',
          );

          return (
            <li key={lesson.contentId}>
              {/* In the course already on screen the row moves the panel above
                  it; anywhere else it is a link, because this app has no
                  classroom open for that course. */}
              {sameCourse ? (
                <button type="button" className={className} onClick={() => onSelect(lesson.contentId)}>
                  {row}
                </button>
              ) : (
                <Link
                  href={`/courses/${lesson.spaceId}?lesson=${lesson.contentId}`}
                  className={className}
                >
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Hearts on comments and on loops are not in this list. Those are things somebody saves while
        reading a discussion, and the public API deliberately leaves them where they were made.
      </p>
    </section>
  );
}
