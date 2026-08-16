export type VideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export const VIDEO_STATUSES: VideoStatus[] = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'];

export type SubtitleStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED';

export const SUBTITLE_STATUSES: SubtitleStatus[] = ['NONE', 'GENERATING', 'READY', 'FAILED'];

export interface Video {
  videoId: string;
  ownerId: string;
  title: string;
  description: string;
  status: VideoStatus;
  fileName: string;
  contentType: string;
  size: number;
  /** Raw upload key: uploads/{videoId}/{fileName} */
  s3Key: string;
  /** Processed HLS master playlist key: processed/{videoId}/hls/... */
  manifestKey?: string;
  /** Subtitle generation state. Absent/undefined means no subtitles yet. */
  subtitleStatus?: SubtitleStatus;
  /** WebVTT subtitle key: subtitles/{videoId}/... */
  subtitleKey?: string;
  /** BCP-47 language code used for transcription, e.g. 'en-US'. */
  subtitleLanguage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubtitleInfo {
  videoId: string;
  subtitleUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface StreamInfo {
  manifestUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}
