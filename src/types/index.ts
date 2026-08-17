export type VideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export const VIDEO_STATUSES: VideoStatus[] = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'];

export type SubtitleStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED';

export const SUBTITLE_STATUSES: SubtitleStatus[] = ['NONE', 'GENERATING', 'READY', 'FAILED'];

/** A translated subtitle track, keyed by BCP-47 language code. */
export interface SubtitleTranslation {
  /** BCP-47 language code, e.g. 'zh-CN'. */
  language: string;
  /** Human-readable label, e.g. 'Mandarin Chinese'. */
  label: string;
  status: SubtitleStatus;
  /** WebVTT subtitle key: subtitles/{videoId}/translations/{language}/... */
  key?: string;
}

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
  /** Original source width in pixels, captured at upload. */
  width?: number;
  /** Original source height in pixels, captured at upload. */
  height?: number;
  /** Original duration in seconds, captured at upload. */
  duration?: number;
  /** Display aspect ratio, e.g. '16:9'. */
  aspectRatio?: string;
  /** Original resolution tier, e.g. '1080p', '1440p', '2160p'. */
  resolutionTier?: string;
  /** Processed HLS master playlist key: processed/{videoId}/hls/... */
  manifestKey?: string;
  /** Subtitle generation state. Absent/undefined means no subtitles yet. */
  subtitleStatus?: SubtitleStatus;
  /** WebVTT subtitle key: subtitles/{videoId}/source/... */
  subtitleKey?: string;
  /** BCP-47 language code used for transcription, e.g. 'en-US'. */
  subtitleLanguage?: string;
  /** Translated subtitle tracks keyed by BCP-47 language code. */
  translations?: Record<string, SubtitleTranslation>;
  /** Poster/thumbnail image key: thumbnails/{videoId}/... */
  thumbnailKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThumbnailInfo {
  videoId: string;
  thumbnailUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface SubtitleInfo {
  videoId: string;
  subtitleUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

/** A subtitle track returned to the player/editor. */
export interface SubtitleTrackInfo extends SubtitleInfo {
  language: string;
  label: string;
  isSource: boolean;
}

/** Editable subtitle content for a single language track. */
export interface SubtitleLanguageContent {
  language: string;
  label: string;
  isSource: boolean;
  content: string;
}

export interface StreamInfo {
  manifestUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}
