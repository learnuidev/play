'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { CheckIcon, ChevronLeftIcon, HelpCircleIcon } from 'lucide-react';
import { cn } from '@ui/lib/utils';
import { useSpaceProgress } from '@api/modules/progress/progress.queries';
import { useSections } from '@api/modules/section/section.queries';
import { useSpace } from '@api/modules/space/space.queries';
import { Skeleton } from '@ui/components/ui/skeleton';
import { SpaceAvatar } from '@learning/components/space/space-avatar';
import { useLearningRoutes } from '@learning/lib/learning-routes';

/**
 * The course, in the panel beside the lesson it is playing.
 *
 * This was the shell's middle column until the lesson stopped having one: a
 * column of navigation costs the video its width for as long as the page is
 * open, while the course is consulted and then left. As a tab it is a click
 * away and out of the way in between, and the lesson gets the whole window.
 *
 * The header still goes back to the course page, where the community's own
 * navigation is waiting — the tab replaced the column, not the way out of it.
 *
 * Every lesson already finished carries a tick, which is what turns this from a
 * table of contents into a record of what is left: the reader who opens it is
 * usually asking "where was I", and the answer is the first row without one.
 */
export function CourseContents({
  spaceId,
  contentId,
}: {
  spaceId: string;
  /** The lesson being read, marked in the list. */
  contentId: string;
}) {
  const routes = useLearningRoutes();
  const { data: spaceData } = useSpace(spaceId);
  const space = spaceData?.space;

  const { data: outline, isLoading } = useSections(spaceId);
  const sections = outline?.sections ?? [];
  const lessons = sections.reduce((total, section) => total + section.contents.length, 0);

  const { data: progress } = useSpaceProgress(spaceId);
  const finished = useMemo(
    () => new Set(progress?.completedContentIds ?? []),
    [progress],
  );

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3 border-b border-border/60 pb-3">
        <Link
          href={routes.course(spaceId)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4 shrink-0 text-muted-foreground" />
          {space ? (
            <SpaceAvatar space={space} size="sm" />
          ) : (
            <Skeleton className="size-6 rounded-md" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {space?.title ?? 'Course'}
          </span>
        </Link>

        {lessons > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {lessons} lesson{lessons === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-2 px-2.5">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ) : sections.length === 0 ? (
        <p className="px-2.5 text-[13px] leading-relaxed text-muted-foreground">
          Nothing published in this course yet.
        </p>
      ) : (
        sections.map((section, index) => (
          <section key={section.sectionId} className="last:mb-0">
            <p className="flex items-baseline gap-2 px-2.5 pb-1.5">
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground/50">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {section.title}
              </span>
            </p>

            {/* The hairline is what makes a section read as owning its
                lessons rather than sitting above them. */}
            <ul className="ml-3 grid gap-0.5 border-l border-border/60 pl-1.5">
              {section.contents.length === 0 ? (
                <li className="px-2 py-1 text-[13px] text-muted-foreground/60">Nothing yet</li>
              ) : (
                section.contents.map((content) => {
                  const active = content.contentId === contentId;
                  const done = finished.has(content.contentId);
                  return (
                    <li key={content.contentId}>
                      <Link
                        href={routes.lesson(spaceId, content.contentId)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                          active
                            ? 'bg-muted font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{content.title}</span>

                        {/* A quiz is not a lesson, and a list that drew them the
                            same way would leave a reader clicking to find out. */}
                        {content.type === 'QUIZ' && (
                          <HelpCircleIcon role="img" aria-label="Quiz" className="size-3.5 shrink-0 opacity-60" />
                        )}

                        {/* Named for the reader who cannot see it: without the
                            label the row is simply a lesson, finished or not. */}
                        {done && (
                          <CheckIcon
                            role="img"
                            aria-label="Finished"
                            className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
