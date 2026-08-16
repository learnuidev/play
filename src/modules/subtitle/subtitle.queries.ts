import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { videoKeys } from '@/modules/video/video.queries';

export const subtitleKeys = {
  detail: (videoId: string) => ['subtitles', videoId] as const,
};

export function useSubtitles(videoId: string, enabled: boolean) {
  return useQuery({
    queryKey: subtitleKeys.detail(videoId),
    queryFn: () => api.getSubtitles(videoId),
    enabled,
  });
}

export function useGenerateSubtitles(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateSubtitles(videoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: videoKeys.detail(videoId) }),
  });
}

export function useSaveSubtitles(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; language?: string }) =>
      api.saveSubtitles(videoId, input.content, input.language),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: subtitleKeys.detail(videoId) });
      qc.invalidateQueries({ queryKey: videoKeys.detail(videoId) });
    },
  });
}
