import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { spaceMemberKeys } from '@api/modules/space-member/space-member.queries';

export const catalogKeys = {
  all: ['catalog'] as const,
  courses: (query = '') => ['catalog', 'courses', query] as const,
  course: (spaceId: string) => ['catalog', 'course', spaceId] as const,
  instructor: (userId: string) => ['catalog', 'instructor', userId] as const,
};

/**
 * The marketplace catalog: every course its author has listed.
 *
 * Public, so it is read without a token — by somebody who has not signed in,
 * which is who a front page is for. It changes when an author publishes or
 * unpublishes a course, not when somebody registers, so it is held for a while.
 *
 * A `query` searches rather than browses, and each search is its own cache
 * entry: typing in a search box and then deleting what you typed should show the
 * catalog you started from, immediately and without a second read.
 *
 * A search keeps the previous results on screen while it runs. Replacing a page
 * of courses with a skeleton and then with a shorter answer is a page that jumps
 * twice per search, which reads as the interface being unsteady — and the caller
 * is told it is looking at the previous answer through `isPlaceholderData`, so
 * it can say so quietly instead.
 */
export function useCatalogCourses(query = '') {
  return useQuery({
    queryKey: catalogKeys.courses(query),
    queryFn: () => api.listCatalogCourses({ query: query || undefined }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
}

/** One listed course and its syllabus. */
export function useCatalogCourse(spaceId: string) {
  return useQuery({
    queryKey: catalogKeys.course(spaceId),
    queryFn: () => api.getCatalogCourse(spaceId),
    enabled: Boolean(spaceId),
    staleTime: 60 * 1000,
  });
}

/**
 * One instructor's public page: who they are, and what they teach here.
 *
 * Public, like the course that links to it. Held for a while: a person's name,
 * face and sentence change when they decide they do, not between one reader and
 * the next, and this is the one page in the marketplace that is about a person
 * rather than about a course.
 */
export function useCatalogInstructor(userId: string) {
  return useQuery({
    queryKey: catalogKeys.instructor(userId),
    queryFn: () => api.getCatalogInstructor(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    // A page that does not exist is a state this screen draws, not a failure to
    // retry three times: the API answers 404 for an id that teaches nothing
    // here, and asking again will not change that.
    retry: false,
  });
}

/**
 * Registering for a course.
 *
 * What it changes is what *this* person may read, so the cache it invalidates
 * is theirs: the courses they are taking, and the course page they are standing
 * on, which now has a lesson to open rather than a button to press. The catalog
 * itself is left alone — one more student does not change a course's card for
 * anybody else — except that it now says one more student. That count is not
 * worth a refetch of the front page, so it is left to go stale on its own.
 */
export function useEnrollInCourse(spaceId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => api.enrollInCourse(spaceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spaceMemberKeys.mine() });
      void qc.invalidateQueries({ queryKey: catalogKeys.course(spaceId) });
    },
  });
}

/**
 * Asking to buy a course.
 *
 * The mirror image of registering, and the difference is *when* anything
 * changes: this answers with a Stripe URL and the caller leaves the app, so
 * there is nothing to invalidate — the membership does not exist yet and will
 * not until Stripe says the payment arrived. A cache refreshed here would be a
 * cache refreshed on a promise, and the page a buyer comes back to is the one
 * that finds out.
 *
 * What it answers with is what the checkout page draws its form from: a client
 * secret, and the publishable key Stripe.js is loaded with. The card details go
 * to Stripe from that form, so nothing about them passes through this hook — the
 * number is typed into Stripe's own iframe and this app never sees it.
 *
 * That is also why this is not an `onSuccess` that enrols: the two facts — "a
 * checkout was opened" and "somebody paid" — are different facts, and only the
 * webhook knows the second one.
 */
export function useStartCheckout(spaceId: string) {
  return useMutation({
    mutationFn: () => api.startCourseCheckout(spaceId),
  });
}

/** Dropping out of a course. The mirror of registering. */
export function useLeaveCourse(spaceId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => api.leaveCourse(spaceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spaceMemberKeys.mine() });
      void qc.invalidateQueries({ queryKey: catalogKeys.course(spaceId) });
    },
  });
}
