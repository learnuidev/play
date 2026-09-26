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

export type AudioStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED';

export const AUDIO_STATUS_LABELS: Record<AudioStatus, string> = {
  NONE: 'No audio',
  GENERATING: 'Generating audio…',
  READY: 'Audio ready',
  FAILED: 'Audio failed',
};

export interface Video {
  videoId: string;
  /**
   * Organization the video belongs to. Absent only on videos uploaded before
   * organizations existed and not yet backfilled (see the backend's
   * `scripts/backfill-video-organizations.js`).
   */
  organizationId?: string;
  ownerId: string;
  title: string;
  description: string;
  status: VideoStatus;
  fileName: string;
  contentType: string;
  size: number;
  s3Key: string;
  width?: number;
  height?: number;
  duration?: number;
  aspectRatio?: string;
  resolutionTier?: string;
  manifestKey?: string;
  audioKey?: string;
  audioStatus?: AudioStatus;
  subtitleStatus?: SubtitleStatus;
  subtitleKey?: string;
  subtitleLanguage?: string;
  translations?: Record<string, SubtitleTranslation>;
  thumbnailKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubtitleTranslation {
  language: string;
  label: string;
  status: SubtitleStatus;
  key?: string;
}

export interface TranslationLanguage {
  bcp47: string;
  label: string;
}

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { bcp47: 'zh-CN', label: 'Mandarin Chinese' },
  { bcp47: 'fr', label: 'French' },
  { bcp47: 'es', label: 'Spanish' },
];

export interface CreateVideoPayload {
  title: string;
  description?: string;
  /** Organization the video belongs to. Every video must have one. */
  organizationId: string;
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  aspectRatio?: string;
  resolutionTier?: string;
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

export interface AudioResponse {
  videoId: string;
  audioUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface ThumbnailResponse {
  videoId: string;
  thumbnailUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface UploadThumbnailResponse {
  video: Video;
  upload: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
}

export interface SubtitleTrackInfo {
  language: string;
  label: string;
  isSource: boolean;
  subtitleUrl: string;
}

export interface SubtitleResponse {
  videoId: string;
  sourceLanguage: string;
  content: string;
  tracks: SubtitleTrackInfo[];
  languages: SubtitleLanguageContent[];
}

export interface SubtitleLanguageContent {
  language: string;
  label: string;
  isSource: boolean;
  content: string;
}

export interface SubtitleCue {
  id: string;
  start: string;
  end: string;
  text: string;
}

export type OrgRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

export const ORG_ROLES: OrgRole[] = ['ADMIN', 'EDITOR', 'VIEWER'];

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

export const ORG_ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  ADMIN: 'Manages the organization, its members, and its courses.',
  EDITOR: 'Creates and edits the organization’s courses.',
  VIEWER: 'Can only view the organization’s courses.',
};

export interface Organization {
  orgId: string;
  name: string;
  slug: string;
  description: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

/** An organization together with the current user's role in it. */
export interface OrganizationSummary extends Organization {
  role: OrgRole;
}

export interface CreateOrganizationPayload {
  name: string;
  description?: string;
}

export interface CreateOrganizationResponse {
  organization: OrganizationSummary;
}

export interface ListOrganizationsResponse {
  organizations: OrganizationSummary[];
  nextToken?: string;
}
