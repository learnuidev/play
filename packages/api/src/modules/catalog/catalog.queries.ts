import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { spaceMemberKeys } from '@api/modules/space-member/space-member.queries';

export const catalogKeys = {
  all: ['catalog'] as const,
  courses: (query = '') => ['catalog', 'courses', query] as const,
  course: (spaceId: string) => ['catalog', 'course', spaceId] as const,
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
