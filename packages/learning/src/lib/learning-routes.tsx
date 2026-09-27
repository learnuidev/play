'use client';

import { createContext, useContext } from 'react';

/**
 * Where a course and its lessons live, as far as the app rendering them is
 * concerned.
 *
 * The lesson experience is the same in both apps — the same player, transcript,
 * notes, loops and marking complete — but the URLs are not: the studio reads a
 * lesson at `/o/{orgId}/spaces/{spaceId}/contents/{contentId}`, where a course
 * belongs to a community, and the marketplace reads one at
 * `/courses/{spaceId}/lessons/{contentId}`, where a learner is taking a course
 * they registered for and the community behind it is not their business.
 *
 * Rather than one component taking a `buildHref` prop per link and passing it
 * down by hand, the app states its routes once, at the top, and every link
 * inside the classroom asks this for it.
 */
export interface LearningRoutes {
  /** The course itself: its outline, its overview. */
  course(spaceId: string): string;
  /** One lesson of a course. */
  lesson(spaceId: string, contentId: string): string;
}

const LearningRoutesContext = createContext<LearningRoutes | null>(null);

export function LearningRoutesProvider({
  routes,
  children,
}: {
  routes: LearningRoutes;
  children: React.ReactNode;
}) {
  return <LearningRoutesContext.Provider value={routes}>{children}</LearningRoutesContext.Provider>;
}

/**
 * The app's routes, as configured above.
 *
 * Throws rather than falling back to a guess: a component that renders a link
 * to the wrong app is a bug that only shows up when somebody clicks it, and a
 * missing provider is a mistake in one screen's tree, not a state to render
 * around.
 */
export function useLearningRoutes(): LearningRoutes {
  const routes = useContext(LearningRoutesContext);
  if (!routes) {
    throw new Error('useLearningRoutes needs a LearningRoutesProvider above it');
  }
  return routes;
}
