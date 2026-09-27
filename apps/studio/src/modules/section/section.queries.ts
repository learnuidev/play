import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const sectionKeys = {
  all: ['sections'] as const,
  /** The space outline: its sections, each with the content under it. */
  outline: (spaceId: string) => ['sections', 'outline', spaceId] as const,
  detail: (sectionId: string) => ['section', sectionId] as const,
  contents: (sectionId: string) => ['section', sectionId, 'contents'] as const,
};

/** A space's outline — what the course page renders. */
export function useSections(spaceId: string) {
  return useQuery({
    queryKey: sectionKeys.outline(spaceId),
    queryFn: () => api.listSections(spaceId),
    enabled: Boolean(spaceId),
  });
}

/** One section's content, paged. The outline answers this whole. */
export function useSectionContents(sectionId: string) {
  return useQuery({
    queryKey: sectionKeys.contents(sectionId),
    queryFn: () => api.listContents(sectionId),
    enabled: Boolean(sectionId),
  });
}

/** One section on its own — a breadcrumb, or a form opened against it. */
export function useSection(sectionId: string) {
  return useQuery({
    queryKey: sectionKeys.detail(sectionId),
    queryFn: () => api.getSection(sectionId),
    enabled: Boolean(sectionId),
  });
}

/**
 * Anything that changes a section, or the content under it, changes the same
 * page — so every mutation here invalidates the space's outline and nothing
 * more precise.
 */
function useOutlineInvalidation(spaceId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: sectionKeys.outline(spaceId) });
}

export function useCreateSection(spaceId: string) {
  const invalidate = useOutlineInvalidation(spaceId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createSection>[1]) => api.createSection(spaceId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateSection(spaceId: string, sectionId: string) {
  const qc = useQueryClient();
  const invalidate = useOutlineInvalidation(spaceId);
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateSection>[1]) => api.updateSection(sectionId, patch),
    onSuccess: ({ section }) => {
      // The detail cache is written from the response so an open form does not
      // flicker back to its old value while the outline refetches.
      qc.setQueryData(sectionKeys.detail(sectionId), { section });
      invalidate();
    },
  });
}

export function useDeleteSection(spaceId: string) {
  const invalidate = useOutlineInvalidation(spaceId);
  return useMutation({
    mutationFn: (sectionId: string) => api.deleteSection(sectionId),
    onSuccess: invalidate,
  });
}
