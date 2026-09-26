export type VideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export const VIDEO_STATUSES: VideoStatus[] = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'];

export type SubtitleStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED';

export const SUBTITLE_STATUSES: SubtitleStatus[] = ['NONE', 'GENERATING', 'READY', 'FAILED'];

export type AudioStatus = 'NONE' | 'GENERATING' | 'READY' | 'FAILED';

export const AUDIO_STATUSES: AudioStatus[] = ['NONE', 'GENERATING', 'READY', 'FAILED'];

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
  /**
   * Organization this video belongs to. Present on everything uploaded since
   * organizations existed; absent only on rows created before that, which
   * `scripts/backfill-video-organizations.js` fills in. New videos cannot be
   * created without one.
   */
  organizationId?: string;
  /** Cognito `sub` of the user who uploaded it. */
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
  /** Extracted audio track key: processed/{videoId}/audio/... */
  audioKey?: string;
  /** Audio extraction state. Absent/undefined means no audio yet. */
  audioStatus?: AudioStatus;
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

export interface AudioInfo {
  videoId: string;
  audioUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

/**
 * Role a user holds inside an organization. Courses (and everything else the
 * organization owns) will be gated on these: admins manage the organization and
 * its members, editors create/edit content, viewers only read it.
 */
export type OrgRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

export const ORG_ROLES: OrgRole[] = ['ADMIN', 'EDITOR', 'VIEWER'];

/**
 * Membership lifecycle. `INVITED` is the placeholder created by an invitation
 * that has not been accepted yet — nothing issues one today, but the role model
 * is already written down so invitations do not need a data migration.
 */
export type OrgMemberStatus = 'ACTIVE' | 'INVITED';

export interface Organization {
  orgId: string;
  /** Display name, e.g. "Acme Learning". */
  name: string;
  /** URL-safe identifier derived from the name and uniquified with a suffix. */
  slug: string;
  description: string;
  /** Cognito `sub` of the user who created it. */
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

/** An organization together with the caller's role in it. */
export interface OrganizationSummary extends Organization {
  role: OrgRole;
}

/**
 * How a space (course) unfolds for the people taking it.
 *
 * - `SELF_PACED` — the clock starts when a member enrolls, so nothing waits on
 *   a calendar and all the content is available immediately.
 * - `SCHEDULED`  — the space starts on `startAt`; sections drip relative to that
 *   date (every `dripIntervalDays` days) rather than relative to enrollment.
 *
 * Stored as a string rather than a number so a third type can be added later
 * without touching existing rows.
 */
export type SpaceType = 'SELF_PACED' | 'SCHEDULED';

export const SPACE_TYPES: SpaceType[] = ['SELF_PACED', 'SCHEDULED'];

/** Days between section unlocks in a scheduled space that does not set its own. */
export const DEFAULT_DRIP_INTERVAL_DAYS = 7;

/**
 * A space (course) inside an organization: the container the organization's
 * videos and courses will be grouped and sequenced in.
 */
export interface Space {
  spaceId: string;
  /** Organization that owns it. A space never exists outside one. */
  organizationId: string;
  title: string;
  description: string;
  type: SpaceType;
  /** Custom accent colour, `#rrggbb`. Absent means the UI derives one. */
  color?: string;
  /**
   * When a `SCHEDULED` space begins, epoch ms. Absent on self-paced spaces,
   * which begin per member at enrollment.
   */
  startAt?: number;
  /** Days between section unlocks. Only meaningful on `SCHEDULED` spaces. */
  dripIntervalDays?: number;
  /** Cover image key: spaces/{spaceId}/cover-{timestamp}.{ext} */
  thumbnailKey?: string;
  /** Cognito `sub` of the user who created it. */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceThumbnailInfo {
  spaceId: string;
  thumbnailUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface OrgMember {
  orgId: string;
  /** Cognito `sub` of the member. */
  userId: string;
  role: OrgRole;
  status: OrgMemberStatus;
  /** Email of the member, when known. */
  email?: string;
  /** Cognito `sub` of the user who added them. */
  invitedBy?: string;
  joinedAt: number;
}
