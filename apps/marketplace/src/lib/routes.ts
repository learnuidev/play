import type { LearningRoutes } from '@play/learning';

/**
 * Where a course and its lessons live in the marketplace.
 *
 * The other half of the studio's answer. A course here is a course, not a
 * community's course: the URL names it and nothing else, because the reader
 * registered for it and does not need to know which organization wrote it to
 * read its lessons.
 */
export const marketplaceLearningRoutes: LearningRoutes = {
  course: (spaceId) => `/courses/${spaceId}`,
  lesson: (spaceId, contentId) => `/courses/${spaceId}/lessons/${contentId}`,
};

/** `/courses/{spaceId}/lessons/{contentId}` */
const LESSON_ROUTE = /^\/courses\/([^/]+)\/lessons\/([^/]+)\/?$/;

export interface LessonRoute {
  spaceId: string;
  contentId: string;
}

/**
 * The lesson a path points at, or nothing when it points somewhere else.
 *
 * The marketplace's mirror of the studio's `lessonRoute`, and the same reason
 * for it: a lesson is read rather than browsed, so the frame has to know which
 * pages are one. Keeping the pattern here rather than in the frame means the
 * header and the page cannot disagree about it.
 */
export function lessonRoute(pathname: string): LessonRoute | null {
  const match = LESSON_ROUTE.exec(pathname);
  if (!match) return null;
  return { spaceId: match[1], contentId: match[2] };
}
