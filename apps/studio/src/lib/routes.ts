/**
 * What a URL means to the shell, and to the classroom.
 *
 * The shell has to know which routes are a *classroom* — a lesson, watched and
 * read rather than navigated around — and which are a *course's own page*,
 * because those are the ones where it gets out of the way. Keeping that
 * knowledge here rather than in each component means the top bar and the sidebar
 * cannot disagree about it.
 */

import type { LearningRoutes } from '@play/learning';

/** `/o/{orgId}/spaces/{spaceId}/contents/{contentId}` */
const LESSON_ROUTE = /^\/o\/[^/]+\/spaces\/([^/]+)\/contents\/([^/]+)\/?$/;

/** `/o/{orgId}/spaces/{spaceId}` */
const SPACE_ROUTE = /^\/o\/[^/]+\/spaces\/([^/]+)\/?$/;

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

export interface SpaceRoute {
  spaceId: string;
}

/**
 * The course a path points at, or nothing when it points somewhere else.
 *
 * A course has a page of its own, and that page already says where you are: the
 * course's name, what it is, and the five things a course is as a strip of tabs.
 * The organization's tab bar above it would be a second and older answer to the
 * same question — and on a course that keeps its own members, the same word
 * twice on one screen. So this is the other route the top bar stays out of; see
 * `OrgTabs`.
 *
 * `/spaces/new` matches the shape but is the create form rather than a course,
 * and it is a page in the Spaces section like any other, so it keeps the bar.
 */
export function spaceRoute(pathname: string): SpaceRoute | null {
  const match = SPACE_ROUTE.exec(pathname);
  if (!match || match[1] === 'new') return null;
  return { spaceId: match[1] };
}

/**
 * Where a course and its lessons live in the studio.
 *
 * The classroom is shared with the marketplace, so it asks the app it is
 * rendering in for its URLs rather than assuming them; this is the studio's
 * answer, and it is the only place in the app that spells them out.
 */
export function studioLearningRoutes(orgId: string): LearningRoutes {
  return {
    course: (spaceId) => `/o/${orgId}/spaces/${spaceId}`,
    lesson: (spaceId, contentId) => `/o/${orgId}/spaces/${spaceId}/contents/${contentId}`,
  };
}
