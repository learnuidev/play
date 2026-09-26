import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ContentLoop } from '@/types';

export const loopKeys = {
  list: (contentId: string) => ['content', contentId, 'loops'] as const,
};

/** The loops on a lesson — everybody's, since they are shared with the course. */
export function useLoops(contentId: string, enabled = true) {
  return useQuery({
    queryKey: loopKeys.list(contentId),
    queryFn: () => api.listLoops(contentId),
    enabled: Boolean(contentId) && enabled,
  });
}

/**
 * Writing one loop is the only thing a loop change can affect: the list is the
 * whole of a loop's world, so every mutation below settles for invalidating it.
 */
function useLoopInvalidation(contentId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: loopKeys.list(contentId) });
}

export function useCreateLoop(contentId: string) {
  const invalidate = useLoopInvalidation(contentId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createLoop>[1]) => api.createLoop(contentId, payload),
    onSuccess: invalidate,
  });
}

/**
 * Renaming, recolouring, or moving where a loop starts and ends.
 *
 * The response is a whole loop, so the caller can take the updated one straight
 * from the mutation rather than waiting for the list to come back.
 */
export function useUpdateLoop(contentId: string) {
  const qc = useQueryClient();
  const invalidate = useLoopInvalidation(contentId);
  return useMutation({
    mutationFn: ({ loopId, ...patch }: { loopId: string } & Parameters<typeof api.updateLoop>[2]) =>
      api.updateLoop(contentId, loopId, patch),
    onSuccess: ({ loop }) => {
      qc.setQueryData(loopKeys.list(contentId), (prev: { loops: ContentLoop[] } | undefined) =>
        prev
          ? { loops: prev.loops.map((item) => (item.loopId === loop.loopId ? loop : item)) }
          : prev,
      );
      invalidate();
    },
  });
}

export function useDeleteLoop(contentId: string) {
  const invalidate = useLoopInvalidation(contentId);
  return useMutation({
    mutationFn: (loopId: string) => api.deleteLoop(contentId, loopId),
    onSuccess: invalidate,
  });
}

/**
 * Liking a loop, and taking the like back.
 *
 * The answer already carries the new count, so the list is written from it
 * rather than refetched: a heart that waits for a round trip before filling in
 * feels broken, and the count it would come back with is the one already here.
 */
export function useToggleLoopLike(contentId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ loopId, liked }: { loopId: string; liked: boolean }) =>
      liked ? api.unlikeLoop(contentId, loopId) : api.likeLoop(contentId, loopId),

    onSuccess: ({ liked, likeCount }, { loopId }) => {
      qc.setQueryData(loopKeys.list(contentId), (prev: { loops: ContentLoop[] } | undefined) =>
        prev
          ? {
              loops: prev.loops.map((loop) =>
                loop.loopId === loopId ? { ...loop, likedByMe: liked, likeCount } : loop,
              ),
            }
          : prev,
      );
    },
  });
}
