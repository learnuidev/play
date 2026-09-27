import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const rewardKeys = {
  all: ['rewards'] as const,
  list: (spaceId: string) => ['space', spaceId, 'rewards'] as const,
  mine: () => ['rewards', 'mine'] as const,
};

/** A course's rewards, each with the grants made under it. */
export function useRewards(spaceId: string) {
  return useQuery({
    queryKey: rewardKeys.list(spaceId),
    queryFn: () => api.listRewards(spaceId),
    enabled: Boolean(spaceId),
  });
}

/** What the caller has earned, across every course. */
export function useMyRewards() {
  return useQuery({
    queryKey: rewardKeys.mine(),
    queryFn: () => api.listMyRewards(),
    staleTime: 30 * 1000,
  });
}

/**
 * Every reward change moves the same two things: the course's reward list, and
 * what the caller holds — an instructor granting to themselves is a learner
 * holding something new.
 */
function useRewardInvalidation(spaceId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: rewardKeys.list(spaceId) });
    qc.invalidateQueries({ queryKey: rewardKeys.mine() });
  };
}

export function useCreateReward(spaceId: string) {
  const invalidate = useRewardInvalidation(spaceId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createReward>[1]) => api.createReward(spaceId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateReward(spaceId: string) {
  const invalidate = useRewardInvalidation(spaceId);
  return useMutation({
    mutationFn: ({ rewardId, ...patch }: { rewardId: string } & Parameters<typeof api.updateReward>[1]) =>
      api.updateReward(rewardId, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteReward(spaceId: string) {
  const invalidate = useRewardInvalidation(spaceId);
  return useMutation({
    mutationFn: (rewardId: string) => api.deleteReward(rewardId),
    onSuccess: invalidate,
  });
}

export function useGrantReward(spaceId: string) {
  const invalidate = useRewardInvalidation(spaceId);
  return useMutation({
    mutationFn: ({ rewardId, ...payload }: { rewardId: string } & Parameters<typeof api.grantReward>[1]) =>
      api.grantReward(rewardId, payload),
    onSuccess: invalidate,
  });
}

export function useRevokeRewardGrant(spaceId: string) {
  const invalidate = useRewardInvalidation(spaceId);
  return useMutation({
    mutationFn: ({ rewardId, memberId }: { rewardId: string; memberId: string }) =>
      api.revokeRewardGrant(rewardId, memberId),
    onSuccess: invalidate,
  });
}
