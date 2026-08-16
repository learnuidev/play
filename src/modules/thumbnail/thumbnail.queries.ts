import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { videoKeys } from '@/modules/video/video.queries';

export const thumbnailKeys = {
  detail: (videoId: string) => ['thumbnail', videoId] as const,
};

export function useThumbnail(videoId: string, enabled: boolean) {
  return useQuery({
    queryKey: thumbnailKeys.detail(videoId),
    queryFn: () => api.getThumbnail(videoId),
    enabled,
  });
}

export function useGenerateThumbnail(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateThumbnail(videoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: thumbnailKeys.detail(videoId) });
      qc.invalidateQueries({ queryKey: videoKeys.detail(videoId) });
    },
  });
}

export function useUploadThumbnail(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.uploadThumbnail>[1]) =>
      api.uploadThumbnail(videoId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: thumbnailKeys.detail(videoId) });
      qc.invalidateQueries({ queryKey: videoKeys.detail(videoId) });
    },
  });
}
