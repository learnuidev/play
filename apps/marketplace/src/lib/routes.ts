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

/** `/join/{spaceId}` */
const JOIN_ROUTE = /^\/join\/[^/]+\/?$/;

/**
 * Whether a path is a door rather than a page: the shared sign-in screen, and
 * the invitation that stands in front of one.
 *
 * The sign-in screen is a windowful of its own, so the frame has to know which
 * pages are it — a bar left in the flow takes its own slice out of the window the
 * screen is meant to be the middle of, which is a page one bar taller than the
 * window with the form sitting below the middle of it.
 *
 * `/join` counts for the same reason and one more. An invitation link arrives at
 * somebody who may have no account yet, so the page *is* the sign-in screen until
 * they have one; once they do it is the offer the screen was standing in front
 * of, drawn in the same column on the same canvas — so it is one screenful in
 * both states, and it wants the same frame either way.
 *
 * Kept here rather than in the frame, like the lesson route above it, so the
 * page's own idea of what it is and the frame's cannot drift apart.
 */
export function authScreenRoute(pathname: string): boolean {
  return pathname === '/sign-in' || JOIN_ROUTE.test(pathname);
}
