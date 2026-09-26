'use client';

import Link from 'next/link';
import { ChevronLeftIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSections } from '@/modules/section/section.queries';
import { useSpace } from '@/modules/space/space.queries';
import { Skeleton } from '@/components/ui/skeleton';
import { SpaceAvatar } from '@/components/space/space-avatar';

/**
 * The course, where the community's navigation usually sits.
 *
 * A lesson is read in a course, not in an organization: what you want beside
 * you is the sections and the lessons in them, with where you are marked — not
 * a video library and a settings link. The header goes back to the course page,
 * which is where the community navigation is waiting.
 */
export function CourseSidebar({
  orgId,
  spaceId,
  contentId,
}: {
  orgId: string;
  spaceId: string;
  /** The lesson being read, marked in the list. */
  contentId: string;
}) {
  const { data: spaceData } = useSpace(spaceId);
  const space = spaceData?.space;

  const { data: outline, isLoading } = useSections(spaceId);
  const sections = outline?.sections ?? [];

  return (
    <aside
      aria-label="Course contents"
      className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex"
    >
      <div className="p-3">
        <Link
          href={`/o/${orgId}/spaces/${spaceId}`}
          className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {isLoading ? (
          <div className="grid gap-2 px-2.5 pt-1">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        ) : sections.length === 0 ? (
          <p className="px-2.5 pt-1 text-xs leading-relaxed text-muted-foreground/80">
            Nothing published in this course yet.
          </p>
        ) : (
          sections.map((section, index) => (
            <section key={section.sectionId} className="mb-4 last:mb-0">
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
                    return (
                      <li key={content.contentId}>
                        <Link
                          href={`/o/${orgId}/spaces/${spaceId}/contents/${content.contentId}`}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'block truncate rounded-md px-2 py-1.5 text-[13px] transition-colors',
                            active
                              ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                          )}
                        >
                          {content.title}
                        </Link>
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          ))
        )}
      </nav>
    </aside>
  );
}
