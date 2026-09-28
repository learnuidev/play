'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, EyeOffIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { ApiError, getCourse, getIdentity, getMyLearning, getSections } from '@/lib/api/v1';
import { useAsync } from '@/lib/use-async';
import { Outline } from './outline';
import { LessonPanel } from './lesson-panel';
import { SavedLessons } from './saved-lessons';
import { RequestNote } from '@/components/request-note';
import type { CatalogCourse, CatalogSection } from '@play/types';

/**
 * The classroom: an outline on the left, a lesson on the right.
 *
 * Two reads decide everything on this page, and the second is only made when the
 * first says it has to be:
 *
 * - `GET /v1/courses/{spaceId}` answers with the course *and* its syllabus, for a
 *   course whose author has published it.
 * - A 404 there means the catalog does not know the course. That is not the end
 *   of it: `GET /v1/courses/{spaceId}/sections` is authorized by access rather
 *   than by publication, so a course the person can read but nobody has listed
 *   still opens here. The page says which of the two happened, because it is the
 *   clearest way to show what the two routes are for.
 */
export function Classroom({ spaceId }: { spaceId: string }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  /**
   * What this person has finished and saved, for every lesson on the page.
   *
   * One read of `/v1/me/learning` for the whole outline, kept in state afterwards
   * so the tick and the heart move the moment a write lands rather than after a
   * refetch. Both sets are held as sets of ids: the outline draws a mark beside
   * every lesson, and asking "is this one done" per row is a lookup, not a search.
   *
   * A refusal is remembered too, and shown: without `learning:read` this endpoint
   * answers 403 and names the scope, and a classroom that quietly drew nothing
   * would be hiding the one sentence that explains why.
   */
  const learning = useAsync(() => getMyLearning(), [spaceId]);

  /**
   * Who the credential acts as.
   *
   * Read for one reason: the discussion marks somebody's **own** comments, and
   * there is no "is this mine" flag on a comment — `authorId` is compared with
   * the `userId` this answers with. It is also the cheapest possible check that
   * the whole page is working, so the request note lists it.
   */
  const identity = useAsync(() => getIdentity(), [spaceId]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [favourited, setFavourited] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!learning.data) return;
    setCompleted(new Set(learning.data.completed.map((entry) => entry.contentId)));
    setFavourited(new Set(learning.data.favourites.map((entry) => entry.contentId)));
  }, [learning.data]);

  const mark = useCallback((contentId: string, next: { completed?: boolean; favourited?: boolean }) => {
    if (next.completed !== undefined) {
      setCompleted((current) => withId(current, contentId, next.completed as boolean));
    }
    if (next.favourited !== undefined) {
      setFavourited((current) => withId(current, contentId, next.favourited as boolean));
    }
  }, []);

  const course = useAsync<{
    course: CatalogCourse | undefined;
    sections: CatalogSection[];
    listed: boolean;
  }>(async () => {
    try {
      const listed = await getCourse(spaceId);
      return { course: listed.course, sections: listed.sections, listed: true };
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
      // Not in the catalog: read the outline by access instead.
      const sections = await getSections(spaceId);
      return { course: undefined, sections, listed: false };
    }
  }, [spaceId]);

  const sections = course.data?.sections ?? [];

  /** The lesson being read: the selected one, or the first the course has. */
  const currentId = useMemo(() => {
    if (selected && sections.some((s) => s.lessons.some((l) => l.contentId === selected))) {
      return selected;
    }
    return sections.flatMap((section) => section.lessons)[0]?.contentId;
  }, [sections, selected]);

  const flatLessons = useMemo(() => sections.flatMap((section) => section.lessons), [sections]);
  const nextLesson = useMemo(() => {
    const index = flatLessons.findIndex((lesson) => lesson.contentId === currentId);
    return index >= 0 ? flatLessons[index + 1] : undefined;
  }, [currentId, flatLessons]);

  /**
   * Remember the lesson in the address bar.
   *
   * `replaceState` rather than a router navigation: the page is already the page
   * — only the panel below changes — and a reload that came back to the first
   * lesson every time would be a classroom that forgets where you were.
   */
  const select = useCallback((contentId: string) => {
    setSelected(contentId);
    const url = new URL(window.location.href);
    url.searchParams.set('lesson', contentId);
    window.history.replaceState(null, '', url);
  }, []);

  if (course.loading) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[18rem_1fr]">
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
        <div className="grid gap-4">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      </div>
    );
  }

  if (course.error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-20">
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-medium">This course is not readable</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {course.error.message}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              A 403 here means the person who authorized this app cannot read the course — the token
              acts as them, and it cannot reach further than they can. A 404 means the id does not
              exist.
            </p>
            <Button asChild variant="secondary" size="sm" className="mt-3">
              <Link href="/courses">
                <ArrowLeftIcon />
                Back to the classroom
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const data = course.data;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {data?.listed ? (
            <Badge variant="secondary" className="font-normal">
              Published
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal">
              <EyeOffIcon className="size-3" />
              Unlisted — read by access
            </Badge>
          )}
          {data?.course && (
            <span className="text-xs text-muted-foreground">{data.course.organizationName}</span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {data?.course?.title ?? 'A course this account can read'}
        </h1>
        {data?.course?.description ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {data.course.description}
          </p>
        ) : (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            The catalog does not list this course, so there is no title or description to show —
            only the outline, which Play answers for anyone who may read it.
          </p>
        )}
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[18rem_1fr]">
        <aside className="lg:sticky lg:top-16 lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto">
          {sections.length > 0 ? (
            <Outline
              sections={sections}
              currentId={currentId}
              completed={completed}
              favourited={favourited}
              onSelect={select}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This course has no sections yet, which is a state rather than an error: a course is
              created before it is written.
            </p>
          )}
        </aside>

        <div className="min-w-0">
          {currentId ? (
            <LessonPanel
              key={currentId}
              contentId={currentId}
              {...(nextLesson ? { nextLesson } : {})}
              state={{
                completed: completed.has(currentId),
                favourited: favourited.has(currentId),
              }}
              {...(identity.data?.owner.userId ? { viewerId: identity.data.owner.userId } : {})}
              onStateChange={(next) => mark(currentId, next)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 px-6 py-20 text-center">
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nothing to read yet — add a lesson in Play&rsquo;s studio.
              </p>
            </div>
          )}
        </div>
      </div>

      <SavedLessons
        lessons={learning.data?.favourites ?? []}
        loading={learning.loading}
        error={learning.error?.message}
        currentId={currentId}
        spaceId={spaceId}
        onSelect={select}
      />

      <RequestNote
        endpoints={[
          data?.listed
            ? `GET /v1/courses/${spaceId}`
            : `GET /v1/courses/${spaceId}/sections`,
          'GET /v1/me',
          'GET /v1/me/learning',
          ...(currentId
            ? [
                `GET /v1/lessons/${currentId}`,
                `GET /v1/lessons/${currentId}/stream`,
                `GET /v1/lessons/${currentId}/subtitles`,
                `GET /v1/lessons/${currentId}/attachments`,
                `GET /v1/lessons/${currentId}/comments`,
              ]
            : []),
        ]}
      />
    </div>
  );
}

/** A set with one id added or removed, as a new set — state is not mutated here. */
function withId(current: Set<string>, id: string, present: boolean): Set<string> {
  const next = new Set(current);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}
