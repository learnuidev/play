'use client';

import { CheckCircle2Icon, HeartIcon, PlayCircleIcon, VideoOffIcon } from 'lucide-react';
import { cn } from '@ui/lib/utils';
import type { CatalogSection } from '@play/types';

/**
 * The course's outline, as a list you can walk down.
 *
 * Built from `GET /v1/courses/{spaceId}` — or, for a course nobody has published,
 * from `GET /v1/courses/{spaceId}/sections`, which is authorized by *access*
 * rather than by publication and answers for the courses the person can read.
 * Either way the shape is the same syllabus the public API serves, and it is
 * deliberately shallow: section, then lesson, then which of them has a video.
 * The commentary, the loops and the progress that Play's own classroom draws all
 * come from endpoints that need a signed-in session, and this app does not have
 * one — which is exactly the line the public API draws.
 */
export function Outline({
  sections,
  currentId,
  completed,
  favourited,
  onSelect,
}: {
  sections: CatalogSection[];
  currentId: string | undefined;
  /** What this person has finished, from `GET /v1/me/learning`. */
  completed: Set<string>;
  /** What they have saved. Drawn beside the lesson, as Play's own outline does. */
  favourited: Set<string>;
  onSelect: (contentId: string) => void;
}) {
  return (
    <nav aria-label="Course outline" className="grid gap-5">
      {sections.map((section, index) => (
        <section key={section.sectionId} className="grid gap-1">
          <h2 className="px-2 text-xs font-medium text-muted-foreground">
            {index + 1}. {section.title}
          </h2>
          <ul className="grid gap-0.5">
            {section.lessons.map((lesson) => {
              const active = lesson.contentId === currentId;
              return (
                <li key={lesson.contentId}>
                  <button
                    type="button"
                    onClick={() => onSelect(lesson.contentId)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition-colors',
                      active
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    {completed.has(lesson.contentId) ? (
                      <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                    ) : lesson.hasVideo ? (
                      <PlayCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                    ) : (
                      <VideoOffIcon className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                    )}
                    <span className="min-w-0 flex-1 leading-snug">{lesson.title}</span>
                    {favourited.has(lesson.contentId) && (
                      <HeartIcon className="mt-0.5 size-3 shrink-0 fill-current text-muted-foreground" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
