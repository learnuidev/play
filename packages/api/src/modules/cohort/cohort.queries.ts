import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';

export const cohortKeys = {
  all: ['cohorts'] as const,
  list: (spaceId: string) => ['space', spaceId, 'cohorts'] as const,
};

/** A course's cohorts, each with the members in it. */
export function useCohorts(spaceId: string) {
  return useQuery({
    queryKey: cohortKeys.list(spaceId),
    queryFn: () => api.listCohorts(spaceId),
    enabled: Boolean(spaceId),
  });
}

/**
 * Everything a cohort change touches is the one list.
 *
 * Membership is drawn from the roster, so the members are invalidated too: a
 * person added to a cohort is a row the members tab shows as being in one.
 */
function useCohortInvalidation(spaceId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: cohortKeys.list(spaceId) });
    qc.invalidateQueries({ queryKey: ['space', spaceId, 'members'] });
  };
}

export function useCreateCohort(spaceId: string) {
  const invalidate = useCohortInvalidation(spaceId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createCohort>[1]) => api.createCohort(spaceId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateCohort(spaceId: string) {
  const invalidate = useCohortInvalidation(spaceId);
  return useMutation({
    mutationFn: ({ cohortId, ...patch }: { cohortId: string } & Parameters<typeof api.updateCohort>[1]) =>
      api.updateCohort(cohortId, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteCohort(spaceId: string) {
  const invalidate = useCohortInvalidation(spaceId);
  return useMutation({
    mutationFn: (cohortId: string) => api.deleteCohort(cohortId),
    onSuccess: invalidate,
  });
}

export function useAddCohortMember(spaceId: string) {
  const invalidate = useCohortInvalidation(spaceId);
  return useMutation({
    mutationFn: ({ cohortId, memberId }: { cohortId: string; memberId: string }) =>
      api.addCohortMember(cohortId, memberId),
    onSuccess: invalidate,
  });
}

export function useRemoveCohortMember(spaceId: string) {
  const invalidate = useCohortInvalidation(spaceId);
  return useMutation({
    mutationFn: ({ cohortId, memberId }: { cohortId: string; memberId: string }) =>
      api.removeCohortMember(cohortId, memberId),
    onSuccess: invalidate,
  });
}
