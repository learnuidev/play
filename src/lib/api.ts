import { fetchAuthSession } from 'aws-amplify/auth';
import type {
  AudioResponse,
  CreateVideoPayload,
  CreateVideoResponse,
  ListVideosResponse,
  StreamResponse,
  SubtitleResponse,
  ThumbnailResponse,
  UploadThumbnailResponse,
  Video,
  VideoStatus,
} from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

async function idToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await idToken()}`,
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      message = data.error?.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  listVideos: (status?: VideoStatus) =>
    request<ListVideosResponse>(`/videos${status ? `?status=${encodeURIComponent(status)}` : ''}`),

  getVideo: (videoId: string) => request<{ video: Video }>(`/videos/${videoId}`),

  createVideo: (payload: CreateVideoPayload) =>
    request<CreateVideoResponse>('/videos', { method: 'POST', body: JSON.stringify(payload) }),

  updateVideo: (videoId: string, patch: Partial<Pick<Video, 'title' | 'description'>>) =>
    request<{ video: Video }>(`/videos/${videoId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteVideo: (videoId: string) => request<void>(`/videos/${videoId}`, { method: 'DELETE' }),

  retryVideo: (videoId: string) => request<{ video: Video }>(`/videos/${videoId}/retry`, { method: 'POST' }),

  getStream: (videoId: string) => request<StreamResponse>(`/videos/${videoId}/stream`),

  getAudio: (videoId: string) => request<AudioResponse>(`/videos/${videoId}/audio`),

  generateAudio: (videoId: string) => request<{ video: Video }>(`/videos/${videoId}/audio`, { method: 'POST' }),

  generateSubtitles: (videoId: string) => request<{ video: Video }>(`/videos/${videoId}/subtitles`, { method: 'POST' }),

  generateTranslations: (videoId: string, languages?: string[]) =>
    request<{ video: Video }>(`/videos/${videoId}/subtitles/translations`, {
      method: 'POST',
      body: JSON.stringify(languages?.length ? { languages } : {}),
    }),

  getSubtitles: (videoId: string) => request<SubtitleResponse>(`/videos/${videoId}/subtitles`),

  saveSubtitles: (videoId: string, content: string, language?: string) =>
    request<{ video: Video }>(`/videos/${videoId}/subtitles`, {
      method: 'PUT',
      body: JSON.stringify(language ? { content, language } : { content }),
    }),

  getThumbnail: (videoId: string) => request<ThumbnailResponse>(`/videos/${videoId}/thumbnail`),

  generateThumbnail: (videoId: string) =>
    request<{ video: Video }>(`/videos/${videoId}/thumbnail/frame`, { method: 'POST' }),

  uploadThumbnail: (videoId: string, payload: { contentType: string; size?: number }) =>
    request<UploadThumbnailResponse>(`/videos/${videoId}/thumbnail`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};
