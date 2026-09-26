import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { contentKeys } from './content.queries';
import { sectionKeys } from '@/modules/section/section.queries';
import type { ContentResponse } from '@/types';

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

    onSuccess: ({ completed }) => {
      qc.setQueryData<ContentResponse>(contentKeys.detail(contentId), (prev) =>
        prev ? { ...prev, viewer: { ...prev.viewer, completed } } : prev,
      );

      // The outline and the course menu draw progress from it as well as this
      // page does, so they are refetched rather than left showing the old state.
      qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
      qc.invalidateQueries({ queryKey: sectionKeys.outline(spaceId) });
    },
  });
}
