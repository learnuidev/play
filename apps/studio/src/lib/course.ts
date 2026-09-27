import type { Content, SectionWithContents } from '@/types';

/**
 * What plays after this lesson.
 *
 * A course is a sequence, so "next" is the next lesson in it — across a section
 * boundary as readily as within one, because that is the order the course is
 * read in and the order the sidebar shows.
 *
 * Lessons with no video are stepped over rather than offered. A card that counts
 * down to a lesson with nothing to play is a card that counts down to a dead
 * end; this is a *playing* next, so it looks for the next thing that can
 * actually be watched.
 */
export function findNextWatchable(
  sections: SectionWithContents[],
  contentId: string,
): Content | null {
  const inOrder = sections.flatMap((section) => section.contents);
  const index = inOrder.findIndex((content) => content.contentId === contentId);
  if (index === -1) return null;

  for (let next = index + 1; next < inOrder.length; next += 1) {
    if (inOrder[next].videoId) return inOrder[next];
  }

  return null;
}
