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

/**
 * One spoken word, with when it is said. Transcribe reports these beside the
 * subtitle it writes; they are what lets a transcript animate word by word,
 * which a cue's start and end cannot say on their own.
 */
export interface TranscriptWord {
  /** The word, carrying its punctuation. */
  w: string;
  /** Start in milliseconds. */
  s: number;
  /** End in milliseconds. */
  e: number;
}

export interface SubtitleResponse {
  videoId: string;
  sourceLanguage: string;
  content: string;
  tracks: SubtitleTrackInfo[];
  languages: SubtitleLanguageContent[];
  /** Word-level timings, when the video was transcribed with them. */
  words?: TranscriptWord[];
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

/**
 * One row of an organization's roster, as the API returns it.
 *
 * `userId` is the member's id once they have accepted, and the invited email
 * address while the invitation is still outstanding — which is why `pending`
 * exists rather than the client inferring it from the id's shape.
 */
export interface OrgMemberApi {
  userId: string;
  role: OrgRole;
  /** The invitation has not been accepted, so the role is not in force yet. */
  pending: boolean;
  /** Only sent to admins: the roster is not an address book. */
  email?: string;
  isYou: boolean;
  /** This pending invitation is addressed to the signed-in user. */
  isInvitationForYou: boolean;
  invitedBy?: string;
  joinedAt: number;
}

export interface ListOrgMembersResponse {
  members: OrgMemberApi[];
  /** The caller's own role, so the page can tell what it may offer. */
  role: OrgRole;
  /** The organization's owner: the one member who cannot be demoted or removed. */
  ownerId?: string;
  /**
   * Where an invitation to this organization is claimed. Sent to admins so the
   * list can hand out the link directly — which is what makes inviting work on
   * a deployment whose mail is not set up yet.
   */
  inviteUrl?: string;
  nextToken?: string;
}

/**
 * What became of the invitation email.
 *
 * A send that fails is not an error: the invitation exists either way, and this
 * is how the page knows whether to say "sent" or hand over the link instead.
 */
export interface MailDelivery {
  sent: boolean;
  /** Address it went out as. */
  from?: string;
  /** Why it did not, when it did not. */
  error?: string;
}

export interface InviteMemberPayload {
  email: string;
  role: OrgRole;
}

export interface InviteMemberResponse {
  member: OrgMemberApi;
  delivery: MailDelivery;
  inviteUrl: string;
}

/** Re-sending an outstanding invitation, optionally correcting its role. */
export interface ResendInvitationResponse {
  member: OrgMemberApi;
  delivery: MailDelivery;
}

export interface OrgMemberResponse {
  member: OrgMemberApi;
}

/**
 * An invitation addressed to the signed-in user's own email address, wherever
 * it came from: the offer, and enough of the organization to decide about it.
 */
export interface MyInvitation {
  orgId: string;
  organizationName: string;
  role: OrgRole;
  invitedBy?: string;
  invitedAt: number;
}

export interface ListMyInvitationsResponse {
  invitations: MyInvitation[];
}

/**
 * How a space (course) unfolds for the people taking it.
 *
 * - `SELF_PACED` — the clock starts when a member enrolls: everything is
 *   available immediately.
 * - `SCHEDULED`  — the space starts on a date and its sections unlock relative
 *   to that date, not to each member's enrollment.
 */
export type SpaceType = 'SELF_PACED' | 'SCHEDULED';

export const SPACE_TYPES: SpaceType[] = ['SELF_PACED', 'SCHEDULED'];

export const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  SELF_PACED: 'Self-paced',
  SCHEDULED: 'Scheduled',
};

export const SPACE_TYPE_DESCRIPTIONS: Record<SpaceType, string> = {
  SELF_PACED: 'Course starts when a member enrolls. All content is available immediately.',
  SCHEDULED: 'Course starts on a specific date. Sections are dripped relative to that date.',
};

/** Days between section unlocks in a scheduled space that does not set its own. */
export const DEFAULT_DRIP_INTERVAL_DAYS = 7;

/**
 * Accent colours a space can be given, and the pool a space without one picks
 * from — so every space is visually distinct without anyone having to choose.
 * Mid-tones only: each one carries white text in the avatar.
 */
export const SPACE_COLORS: string[] = [
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#14b8a6',
  '#0ea5e9',
];

/**
 * A space (course) inside an organization: the container its videos and courses
 * are grouped and sequenced in.
 */
export interface Space {
  spaceId: string;
  organizationId: string;
  title: string;
  description: string;
  type: SpaceType;
  /** Custom accent colour, `#rrggbb`. Absent means the UI derives one. */
  color?: string;
  /** Start of a scheduled space, epoch ms. Absent on self-paced spaces. */
  startAt?: number;
  /** Days between section unlocks. Only meaningful on scheduled spaces. */
  dripIntervalDays?: number;
  thumbnailKey?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSpacePayload {
  title: string;
  description?: string;
  type: SpaceType;
  color?: string;
  /**
   * Start of a scheduled space. An ISO date (`2025-01-15`) or epoch ms; the API
   * pins a date-only value to UTC midnight so the start day is the same
   * wherever it is read.
   */
  startAt?: number | string;
  dripIntervalDays?: number;
}

export interface CreateSpaceResponse {
  space: Space;
}

export interface ListSpacesResponse {
  spaces: Space[];
  nextToken?: string;
}

export interface UploadSpaceThumbnailResponse {
  space: Space;
  upload: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
}

export interface SpaceThumbnailResponse {
  spaceId: string;
  thumbnailUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

/** What a piece of content *is*. One value today, a union so more can join it. */
export type ContentType = 'VIDEO';

export const CONTENT_TYPES: ContentType[] = ['VIDEO'];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  VIDEO: 'Video',
};

/**
 * A section of a space: the heading its content is published under.
 *
 * `position` is the order it is read in, and it is the author's decision rather
 * than a timestamp — a course is arranged, not merely accumulated.
 */
export interface Section {
  sectionId: string;
  spaceId: string;
  organizationId: string;
  title: string;
  description: string;
  position: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** A section together with the content filed under it. */
export interface SectionWithContents extends Section {
  contents: Content[];
}

/**
 * A ProseMirror/TipTap document — what the notes editor reads and writes.
 * Kept as a tree rather than an HTML string so it can be rendered node by node.
 */
export type NotesDocument = Record<string, unknown>;

/** One piece of content in a section: a video and the material around it. */
export interface Content {
  contentId: string;
  sectionId: string;
  spaceId: string;
  organizationId: string;
  title: string;
  type: ContentType;
  /** The video this content plays. Absent while a lesson is still a draft. */
  videoId?: string;
  notes?: NotesDocument;
  position: number;
  fileCount: number;
  favouriteCount: number;
  commentCount: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** A file attached to a piece of content. */
export interface ContentFile {
  contentId: string;
  fileId: string;
  name: string;
  key: string;
  contentType: string;
  size?: number;
  uploadedBy: string;
  createdAt: number;
}

/** An attachment as the listing returns it, with a signed URL to fetch it. */
export interface ContentFileWithUrl extends ContentFile {
  url?: string;
}

/** What the current user has done with a piece of content. */
export interface ContentViewerState {
  favourited: boolean;
  inPlaylist: boolean;
  /** Marked as done by this user. */
  completed: boolean;
}

/** The answer to marking a lesson done, or taking it back. */
export interface CompletionResponse {
  completed: boolean;
}

export interface CreateSectionPayload {
  title: string;
  description?: string;
  position?: number;
}

export interface UpdateSectionPayload {
  title?: string;
  description?: string;
  position?: number;
}

export interface CreateContentPayload {
  title: string;
  type?: ContentType;
  videoId?: string;
  notes?: NotesDocument;
  position?: number;
}

export interface UpdateContentPayload {
  title?: string;
  type?: ContentType;
  /** `null` unlinks the video. */
  videoId?: string | null;
  /** `null` clears the notes. */
  notes?: NotesDocument | null;
  position?: number;
}

export interface UploadContentFilePayload {
  name: string;
  contentType: string;
  size?: number;
}

export interface SectionResponse {
  section: Section;
}

/** The space outline: sections in reading order, each with its content. */
export interface ListSectionsResponse {
  sections: SectionWithContents[];
  /** True when the course was larger than the outline reads in one go. */
  truncated: boolean;
}

export interface ListContentsResponse {
  contents: Content[];
  nextToken?: string;
}

export interface ContentResponse {
  content: Content;
  viewer: ContentViewerState;
}

/**
 * What creating or editing content answers with.
 *
 * Unlike a read, it carries no `viewer`: writing content is an editorial act,
 * and the caller's own favouriting of it is not part of the answer.
 */
export interface ContentMutationResponse {
  content: Content;
}

export interface ListContentFilesResponse {
  files: ContentFileWithUrl[];
  expiresAt: number;
}

export interface ContentFileResponse {
  file: ContentFile;
  url: string;
  expiresAt: number;
}

export interface UploadContentFileResponse {
  file: ContentFile;
  upload: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
}

export type FavouriteTargetType = 'CONTENT' | 'COMMENT';

/** One learner's favourite, over a piece of content or a single comment. */
export interface Favourite {
  userId: string;
  targetKey: string;
  targetType: FavouriteTargetType;
  targetId: string;
  contentId?: string;
  createdAt: number;
}

/** A favourite together with what it points at, when that still exists. */
export interface FavouriteEntry extends Favourite {
  content?: Content;
  comment?: Comment;
}

/** A piece of content in a learner's playlist. */
export interface PlaylistEntry {
  userId: string;
  contentId: string;
  addedAt: number;
  content?: Content;
}

/**
 * A comment on a piece of content, or a reply to one. Replies are two levels
 * deep: `parentId` is the thread's root, `replyToId` the comment answered.
 */
export interface Comment {
  contentId: string;
  commentId: string;
  organizationId: string;
  authorId: string;
  authorName: string;
  body: string;
  parentId?: string;
  replyToId?: string;
  replyCount: number;
  favouriteCount: number;
  editedAt?: number;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A comment as a read returns it: the comment, plus what the caller has done
 * with it. The favourite comes with the thread rather than being asked about
 * per row, so a discussion is drawn with its hearts in the right state from the
 * one request that read it.
 */
export interface ApiComment extends Comment {
  favourited: boolean;
}

export interface CommentThread {
  comment: ApiComment;
  replies: ApiComment[];
}

export interface CreateCommentPayload {
  body: string;
  /** The comment being replied to. Omit for a top-level comment. */
  parentId?: string;
  /** The specific comment being answered, when that differs from `parentId`. */
  replyToId?: string;
}

export interface FavouriteResponse {
  favourited: boolean;
  favouriteCount: number;
}

export interface PlaylistResponse {
  inPlaylist: boolean;
}

export interface ListFavouritesResponse {
  favourites: FavouriteEntry[];
  nextToken?: string;
}

export interface ListPlaylistResponse {
  items: PlaylistEntry[];
  nextToken?: string;
}

export interface ListCommentsResponse {
  threads: CommentThread[];
  truncated: boolean;
}

/**
 * Accent colours a loop can wear.
 *
 * Its own palette rather than the spaces' one: a loop is a note to yourself in
 * the margin of a lesson, and it should not be possible to confuse one with a
 * course.
 */
export const LOOP_COLORS: string[] = [
  '#f43f5e',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#0ea5e9',
  '#8b5cf6',
];

/**
 * A named stretch of a lesson's video: the piece worth hearing again.
 *
 * Boundaries are milliseconds because that is what a player seeks by — the
 * transcript's line numbers are derivable from them, and a loop survives that
 * transcript being re-cut.
 */
export interface ContentLoop {
  contentId: string;
  loopId: string;
  name: string;
  color?: string;
  startMs: number;
  endMs: number;
  /** How many people have liked it. */
  likeCount: number;
  /** Whether the caller is one of them. */
  likedByMe: boolean;
  /** Cognito `sub` of whoever made it. */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** The answer to liking a loop, or taking the like back. */
export interface LoopLikeResponse {
  liked: boolean;
  likeCount: number;
}

export interface CreateLoopPayload {
  name: string;
  startMs: number;
  endMs: number;
  color?: string;
}

export interface UpdateLoopPayload {
  name?: string;
  startMs?: number;
  endMs?: number;
  color?: string;
}

export interface ListLoopsResponse {
  loops: ContentLoop[];
}

export interface LoopResponse {
  loop: ContentLoop;
}
