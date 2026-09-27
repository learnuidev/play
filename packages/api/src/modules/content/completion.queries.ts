import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { contentKeys } from './content.queries';
import { rewardKeys } from '@api/modules/reward/reward.queries';
import { sectionKeys } from '@api/modules/section/section.queries';
import { spaceKeys } from '@api/modules/space/space.queries';
import type { ContentResponse } from '@play/types';

/**
 * Marking a lesson done, and taking it back.
 *
 * One mutation for both, because it is one decision with two directions: what
 * the caller has is what the button shows, and pressing it means the opposite.
 * The response carries the new state, so it is written straight into the cached
 * content rather than waited for.
 */
export function useToggleCompletion(contentId: string, spaceId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (completed: boolean) =>
      completed ? api.uncompleteContent(contentId) : api.completeContent(contentId),

    onSuccess: ({ completed, earned }) => {
      qc.setQueryData<ContentResponse>(contentKeys.detail(contentId), (prev) =>
        prev ? { ...prev, viewer: { ...prev.viewer, completed } } : prev,
      );

      // The outline and the course menu draw progress from it as well as this
      // page does, so they are refetched rather than left showing the old state.
      qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
      qc.invalidateQueries({ queryKey: sectionKeys.outline(spaceId) });

      // Finishing a lesson is the moment a milestone can be crossed, so the
      // course's rewards may have changed too — what the caller now holds is
      // refetched rather than left stale until something else asks for it.
      if (earned && earned.length > 0) {
        qc.invalidateQueries({ queryKey: rewardKeys.mine() });
        qc.invalidateQueries({ queryKey: rewardKeys.list(spaceId) });
        qc.invalidateQueries({ queryKey: spaceKeys.stats(spaceId) });
      }
    },
  });
}
