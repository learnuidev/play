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
