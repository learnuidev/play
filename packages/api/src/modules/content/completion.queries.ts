import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { contentKeys } from './content.queries';
import { rewardKeys } from '@api/modules/reward/reward.queries';
import { sectionKeys } from '@api/modules/section/section.queries';
import { spaceKeys } from '@api/modules/space/space.queries';
import type { ContentResponse } from '@play/types';

/**
 * What the caller has finished, and what that leaves them to open.
 *
 * Kept together because the second is read from the first: the lesson a course
 * card offers is the first one this list does not hold.
 */
export const completionKeys = {
  /** Where the caller is up to in every course they are in, in one read. */
  next: () => ['completions', 'next-lessons'] as const,
};

/**
 * The lesson each course the caller is in is up to.
 *
 * Read by the marketplace's own course cards, which lead straight into the
 * lesson somebody has not finished rather than to a course page they would have
 * to pick one from. `enabled` exists because those cards render for people who
 * have not signed in, and asking this question anonymously is a 401.
 */
export function useNextLessons(enabled = true) {
  return useQuery({
    queryKey: completionKeys.next(),
    queryFn: () => api.listMyNextLessons(),
    staleTime: 30 * 1000,
    enabled,
  });
}

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

      // Finishing this lesson may be what moves the course on: the lesson it
      // now leads with is a different one, and the card that offers it is a
      // page away rather than on this screen.
      qc.invalidateQueries({ queryKey: completionKeys.next() });

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
