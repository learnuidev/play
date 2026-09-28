import { useQuery } from '@tanstack/react-query';
import { api } from '@api/lib/api';

/**
 * How far the caller has got.
 *
 * Two reads of one fact, and the difference between them is what they are for:
 * the list answers "where am I in each of my courses", which a page of cards
 * wants, and the course's own read names the lessons themselves, which an
 * outline wants so it can tick them.
 *
 * Both are the caller's own progress — there is no read here of anybody else's —
 * so both are keyed under one prefix, and a lesson marked done invalidates the
 * pair at once rather than leaving a card and an outline disagreeing about the
 * same course.
 */
export const progressKeys = {
  all: ['progress'] as const,
  /** Every course the caller is in, each with how far they have got. */
  mine: () => ['progress', 'mine'] as const,
  /** One course's progress, naming the lessons they have finished. */
  space: (spaceId: string) => ['progress', 'space', spaceId] as const,
};

/**
 * How far the caller has got in each of their courses.
 *
 * `enabled` exists for the marketplace, which renders for people who have not
 * signed in: this is the caller's own progress, and asking for it anonymously is
 * a 401.
 */
export function useMyProgress(enabled = true) {
  return useQuery({
    queryKey: progressKeys.mine(),
    queryFn: () => api.listMyProgress(),
    staleTime: 30 * 1000,
    enabled,
  });
}

/**
 * How far the caller has got in one course.
 *
 * Asked by the course page and by the classroom's course tab, which draw the same
 * syllabus and tick the same lessons. `enabled` is separate from `spaceId`
 * because a course page is read by people who are not in the course at all: the
 * outline is theirs to read, their progress through it is not a question to ask.
 */
export function useSpaceProgress(spaceId: string, enabled = true) {
  return useQuery({
    queryKey: progressKeys.space(spaceId),
    queryFn: () => api.getSpaceProgress(spaceId),
    staleTime: 30 * 1000,
    enabled: Boolean(spaceId) && enabled,
  });
}
