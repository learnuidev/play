import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { VideoStatus } from '@/types';

export const videoKeys = {
  all: ['videos'] as const,
  list: (status: VideoStatus | 'ALL' = 'ALL', organizationId?: string) =>
    ['videos', organizationId ?? 'mine', status] as const,
  detail: (videoId: string) => ['video', videoId] as const,
  stream: (videoId: string) => ['stream', videoId] as const,
  audio: (videoId: string) => ['audio', videoId] as const,
};

const POLL_INTERVAL_MS = 5000;

/**
 * Lists videos for the studio. Passing `organizationId` switches the list from
 * "my uploads" to that organization's shared library.
 */
export function useVideos(status: VideoStatus | 'ALL' = 'ALL', organizationId?: string) {
  return useQuery({
    queryKey: videoKeys.list(status, organizationId),
    queryFn: () =>
      api.listVideos(status === 'ALL' ? undefined : status, organizationId),
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
          video.audioStatus === 'GENERATING');
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

export function useAudio(videoId: string, enabled: boolean) {
  return useQuery({
    queryKey: videoKeys.audio(videoId),
    queryFn: () => api.getAudio(videoId),
    enabled,
  });
}

export function useGenerateAudio(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateAudio(videoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: videoKeys.detail(videoId) });
      qc.invalidateQueries({ queryKey: videoKeys.all });
    },
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
