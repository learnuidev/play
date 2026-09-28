import { listCompletionsInSpace } from './completions';
import { readSpaceOutline } from './outline';
import type { SpaceProgressResponse } from '../types';

/**
 * How far one learner has got in one course.
 *
 * Two reads and one rule, in one place because progress is asked for from three
 * directions — a card that says "40% complete", an outline that ticks the
 * lessons somebody has finished, and the next lesson to open — and three
 * answers worked out three ways is three chances to disagree about what "done"
 * means.
 *
 * A lesson counts as done because the learner said so, not because the video
 * reached its end: marking a lesson complete is the only thing that moves
 * progress in this product. The lessons are the ones the course publishes *now*,
 * so a lesson deleted after it was finished stops counting, and the total it is
 * measured against is the same list the outline shows — past the ceiling a very
 * large outline reads to, the percentage and the page agree because they are
 * counting the same rows.
 */
export async function readSpaceProgress(
  userId: string,
  spaceId: string,
): Promise<SpaceProgressResponse> {
  const [outline, completions] = await Promise.all([
    readSpaceOutline(spaceId),
    listCompletionsInSpace(userId, spaceId),
  ]);

  const finished = new Set(completions.map((completion) => completion.contentId));
  const lessons = outline.sections.flatMap((section) => section.contents);
  const completed = lessons.filter((lesson) => finished.has(lesson.contentId));

  // The first lesson in the course's own order they have not finished — and once
  // they have finished them all, the first again, so a finished course still has
  // somewhere to open rather than nowhere.
  const next = lessons.find((lesson) => !finished.has(lesson.contentId)) ?? lessons[0];

  return {
    spaceId,
    lessonCount: lessons.length,
    completedCount: completed.length,
    completedContentIds: completed.map((lesson) => lesson.contentId),
    nextContentId: next?.contentId,
  };
}
