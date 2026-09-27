import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { putFileToPresignedUrl } from '@api/lib/upload';
import { sectionKeys } from '@api/modules/section/section.queries';
import type { UploadContentFilePayload } from '@play/types';

export const contentKeys = {
  all: ['content'] as const,
  detail: (contentId: string) => ['content', contentId] as const,
  files: (contentId: string) => ['content', contentId, 'files'] as const,
};

/** One piece of content, with what the caller has done with it. */
export function useContent(contentId: string) {
  return useQuery({
    queryKey: contentKeys.detail(contentId),
    queryFn: () => api.getContent(contentId),
    enabled: Boolean(contentId),
  });
}

/**
 * A piece of content's attachments, each with a signed URL. The signature
 * expires on a clock the client cannot see, so this is refetched before the
 * shortest TTL would have run out rather than left to go blank.
 */
export function useContentFiles(contentId: string) {
  return useQuery({
    queryKey: contentKeys.files(contentId),
    queryFn: () => api.listContentFiles(contentId),
    enabled: Boolean(contentId),
    staleTime: 5 * 60 * 1000,
  });
}

/** Both the content and the outline it sits in, since its title shows in both. */
function useContentInvalidation(contentId: string, spaceId?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
    if (spaceId) qc.invalidateQueries({ queryKey: sectionKeys.outline(spaceId) });
    qc.invalidateQueries({ queryKey: sectionKeys.all });
  };
}

export function useCreateContent(sectionId: string, spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createContent>[1]) => api.createContent(sectionId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sectionKeys.outline(spaceId) });
      qc.invalidateQueries({ queryKey: sectionKeys.contents(sectionId) });
    },
  });
}

export function useUpdateContent(contentId: string, spaceId?: string) {
  const invalidate = useContentInvalidation(contentId, spaceId);
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateContent>[1]) => api.updateContent(contentId, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteContent(spaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contentId: string) => api.deleteContent(contentId),
    onSuccess: (_data, contentId) => {
      qc.removeQueries({ queryKey: contentKeys.detail(contentId) });
      if (spaceId) qc.invalidateQueries({ queryKey: sectionKeys.outline(spaceId) });
      qc.invalidateQueries({ queryKey: sectionKeys.all });
    },
  });
}

/**
 * Attaches a file: the reservation goes through the API, the bytes go straight
 * to S3 with the URL it returns, and the listing is refetched once they land.
 */
export function useUploadContentFile(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, onProgress }: { file: File; onProgress?: (percent: number) => void }) => {
      const payload: UploadContentFilePayload = {
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      };
      const { upload } = await api.uploadContentFile(contentId, payload);
      await putFileToPresignedUrl(file, upload, onProgress);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contentKeys.files(contentId) });
      qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
      qc.invalidateQueries({ queryKey: sectionKeys.all });
    },
  });
}

export function useDeleteContentFile(contentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => api.deleteContentFile(contentId, fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contentKeys.files(contentId) });
      qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
    },
  });
}
