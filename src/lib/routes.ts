/**
 * What a URL means to the shell.
 *
 * The shell has to know which routes are a *classroom* — a lesson, watched and
 * read rather than navigated around — because those are the ones where it gets
 * out of the way. Keeping that knowledge here rather than in each component
 * means the top bar and the sidebar cannot disagree about it.
 */

/** `/o/{orgId}/spaces/{spaceId}/contents/{contentId}` */
const LESSON_ROUTE = /^\/o\/[^/]+\/spaces\/([^/]+)\/contents\/([^/]+)\/?$/;

export interface LessonRoute {
  spaceId: string;
  contentId: string;
}

/** The lesson a path points at, or nothing when it points somewhere else. */
export function lessonRoute(pathname: string): LessonRoute | null {
  const match = LESSON_ROUTE.exec(pathname);
  if (!match) return null;
  return { spaceId: match[1], contentId: match[2] };
}
