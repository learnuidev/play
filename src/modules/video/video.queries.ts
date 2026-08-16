import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { VideoStatus } from '@/types';

export const videoKeys = {
  all: ['videos'] as const,
  list: (status: VideoStatus | 'ALL' = 'ALL') => ['videos', status] as const,
  detail: (videoId: string) => ['video', videoId] as const,
  stream: (videoId: string) => ['stream', videoId] as const,
};

const POLL_INTERVAL_MS = 5000;

export function useVideos(status: VideoStatus | 'ALL' = 'ALL') {
  return useQuery({
    queryKey: videoKeys.list(status),
    queryFn: () => api.listVideos(status === 'ALL' ? undefined : status),
    refetchInterval: (query) => {
      const videos = query.state.data?.videos ?? [];
      return videos.some((v) => v.status === 'UPLOADING' || v.status === 'PROCESSING')
        ? POLL_INTERVAL_MS
        : false;
    },
  });
}

export function useVideo(videoId: string) {
  return useQuery({
    queryKey: videoKeys.detail(videoId),
    queryFn: () => api.getVideo(videoId),
    refetchInterval: (query) => {
      const video = query.state.data?.video;
      const needsPoll =
        !!video &&
        (video.status === 'UPLOADING' ||
          video.status === 'PROCESSING' ||
          video.subtitleStatus === 'GENERATING' ||
          video.thumbnailStatus === 'GENERATING');
      return needsPoll ? POLL_INTERVAL_MS : false;
    },
  });
}

export function useStream(videoId: string, enabled: boolean) {
  return useQuery({
    queryKey: videoKeys.stream(videoId),
    queryFn: () => api.getStream(videoId),
    enabled,
  });
}

export function useUpdateVideo(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateVideo>[1]) => api.updateVideo(videoId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: videoKeys.detail(videoId) });
      qc.invalidateQueries({ queryKey: videoKeys.all });
    },
  });
}

export function useCreateVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createVideo>[0]) => api.createVideo(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: videoKeys.all }),
  });
}
