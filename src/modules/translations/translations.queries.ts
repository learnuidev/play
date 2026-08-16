import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { videoKeys } from '@/modules/video/video.queries';
import { subtitleKeys } from '@/modules/subtitle/subtitle.queries';

export function useGenerateTranslations(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (languages?: string[]) => api.generateTranslations(videoId, languages),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: videoKeys.detail(videoId) });
      qc.invalidateQueries({ queryKey: subtitleKeys.detail(videoId) });
    },
  });
}
