export type VideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export const VIDEO_STATUSES: VideoStatus[] = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'];

export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = {
  UPLOADING: 'Uploading',
  PROCESSING: 'Encoding',
  READY: 'Ready',
  FAILED: 'Failed',
};

export type SubtitleStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED';

export const SUBTITLE_STATUS_LABELS: Record<SubtitleStatus, string> = {
  NONE: 'No subtitles',
  GENERATING: 'Generating subtitles…',
  READY: 'Subtitles ready',
  FAILED: 'Subtitles failed',
};

export interface Video {
  videoId: string;
  ownerId: string;
  title: string;
  description: string;
  status: VideoStatus;
  fileName: string;
  contentType: string;
  size: number;
  s3Key: string;
  manifestKey?: string;
  subtitleStatus?: SubtitleStatus;
  subtitleKey?: string;
  subtitleLanguage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateVideoPayload {
  title: string;
  description?: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface CreateVideoResponse {
  video: Video;
  upload: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
}

export interface ListVideosResponse {
  videos: Video[];
  nextToken?: string;
}

export interface StreamResponse {
  videoId: string;
  manifestUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface SubtitleResponse {
  videoId: string;
  subtitleUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
  content: string;
}

export interface SubtitleCue {
  id: string;
  start: string;
  end: string;
  text: string;
}
