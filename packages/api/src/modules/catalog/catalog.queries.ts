import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { spaceMemberKeys } from '@api/modules/space-member/space-member.queries';

export const catalogKeys = {
  all: ['catalog'] as const,
  courses: () => ['catalog', 'courses'] as const,
  course: (spaceId: string) => ['catalog', 'course', spaceId] as const,
};

/**
 * The marketplace catalog: every course its author has listed.
 *
 * Public, so it is read without a token — by somebody who has not signed in,
 * which is who a front page is for. It changes when an author publishes or
 * unpublishes a course, not when somebody registers, so it is held for a while.
 */
export function useCatalogCourses() {
  return useQuery({
    queryKey: catalogKeys.courses(),
    queryFn: () => api.listCatalogCourses(),
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
