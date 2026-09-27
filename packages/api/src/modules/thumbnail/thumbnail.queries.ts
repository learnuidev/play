import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { videoKeys } from '@api/modules/video/video.queries';

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

const POLL_INTERVAL_MS = 5000;

/**
 * Asks the backend to capture the video's first frame as its default
 * thumbnail. The capture runs as a MediaConvert job, so the video record only
 * gains `thumbnailKey` a few seconds later.
 */
export function useGenerateThumbnail(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateThumbnail(videoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: videoKeys.detail(videoId) });
    },
  });
}

/**
 * Re-reads the video record while its default thumbnail is being captured so
 * the card picks up `thumbnailKey` as soon as the job finishes. Shares the
 * video query key with the page, so both update together.
 */
export function useThumbnailCapture(videoId: string, enabled: boolean) {
  return useQuery({
    queryKey: videoKeys.detail(videoId),
    queryFn: () => api.getVideo(videoId),
    enabled,
    refetchInterval: enabled ? POLL_INTERVAL_MS : false,
  });
}

/** Whether a thumbnail key came from a user upload rather than a captured frame. */
export function isCustomThumbnail(thumbnailKey: string | undefined): boolean {
  return !!thumbnailKey && thumbnailKey.includes('/custom-');
}
