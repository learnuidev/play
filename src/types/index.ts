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

/**
 * One spoken word, with when it is said.
 *
 * Transcribe reports these alongside the subtitle it writes, and they are what
 * lets a transcript animate word by word instead of cue by cue — a cue is a
 * line of text with a start and an end, which says nothing about the order its
 * words arrive in.
 *
 * `w` carries its punctuation, because that is how it appears in the subtitle
 * text it will be laid against.
 */
export interface TranscriptWord {
  w: string;
  /** Start, epoch-relative to the video, in milliseconds. */
  s: number;
  /** End, in milliseconds. */
  e: number;
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
 * Membership lifecycle.
 *
 * - `ACTIVE`  — the person is in the organization; `userId` is their Cognito
 *   `sub` and every authorization check reads this row.
 * - `INVITED` — an invitation nobody has accepted yet. It grants nothing:
 *   `requireOrganizationAccess` treats it as no membership at all, so the
 *   invited rows are invisible to the API until they are claimed.
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
  /**
   * How many admins the organization currently has, kept on the row rather
   * than counted on read. It is what makes "an organization always has at least
   * one admin" a condition DynamoDB enforces on the same item the last admin is
   * being demoted or removed in, so two admins demoting each other at the same
   * moment cannot both succeed and leave nobody in charge.
   *
   * Absent on organizations created before it existed; treated as 1.
   */
  adminCount?: number;
  createdAt: number;
  updatedAt: number;
}

/** An organization together with the caller's role in it. */
export interface OrganizationSummary extends Organization {
  role: OrgRole;
}

/**
 * An invitation addressed to the caller's own email address, as the API hands
 * it out: the offer, and enough of the organization to decide about it.
 *
 * No membership is involved — the caller has none yet, which is the whole point
 * — so this is not the roster shape.
 */
export interface MyInvitation {
  orgId: string;
  organizationName: string;
  role: OrgRole;
  invitedBy?: string;
  invitedAt: number;
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
  /**
   * Cognito `sub` of the member — except while `status` is `INVITED`, when it
   * is the invited email address instead. An invitation is addressed to a
   * person the pool may not know yet, so the only identifier there is to key
   * the row by is the address it was sent to; accepting it rewrites the row
   * under the real `sub`. Nothing reads an `INVITED` row as an identity: the
   * authorization check requires `ACTIVE`.
   */
  userId: string;
  role: OrgRole;
  status: OrgMemberStatus;
  /**
   * Email of the member, when known. Set on every row: at invitation time from
   * the invite, and at acceptance time (or creation) from the caller's claims.
   */
  email?: string;
  /**
   * The address the invitation was sent to. Only ever on an `INVITED` row, and
   * the reason it is kept separately from `email` is that it is *what the
   * invitation is for* rather than a property of the person: it is what the
   * invitation-accepting flow matches on, so an invite is claimed by the person
   * who can sign in as the address it named.
   */
  invitedEmail?: string;
  /** Cognito `sub` of the user who added them. */
  invitedBy?: string;
  /** When the membership began, or when the invitation was sent. */
  joinedAt: number;
}

/**
 * What a piece of content *is*. One value today — a video from the
 * organization's library — with the notes beside it.
 *
 * It is stored as a string rather than a number so a second kind (`TEXT`,
 * `FILE`, `LIVE`) can be added later without migrating existing rows, and so an
 * unknown value read back by an older client is inert rather than nonsense.
 */
export type ContentType = 'VIDEO';

export const CONTENT_TYPES: ContentType[] = ['VIDEO'];

/** A section of a space: the grouping its content is published under. */
export interface Section {
  /** ULID, the table key. */
  sectionId: string;
  /** The space it belongs to. A section never exists outside one. */
  spaceId: string;
  /**
   * The organization that owns the space. Denormalized from the space so
   * authorizing a section — and anything filed under it — is one read plus the
   * membership check, rather than a walk up the tree. A space never changes
   * organization, so the copy cannot drift.
   */
  organizationId: string;
  /** Required, 2–80 characters (whitespace collapsed). */
  title: string;
  /** Optional, ≤ 500 characters. */
  description: string;
  /** 1-based order inside the space. Sparse: gaps are legal. */
  position: number;
  /** Cognito `sub` of the user who created it. */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** A section together with everything filed under it, as the outline needs it. */
export interface SectionWithContents extends Section {
  contents: Content[];
}

/** One piece of content in a section: a video and the material around it. */
export interface Content {
  /** ULID, the table key. */
  contentId: string;
  sectionId: string;
  /** Denormalized from the section, so a content read authorizes in one hop. */
  spaceId: string;
  /** Denormalized from the space, for the same reason as on a section. */
  organizationId: string;
  /** Required, 2–120 characters (whitespace collapsed). */
  title: string;
  type: ContentType;
  /**
   * The video this content plays, for `VIDEO` content. Optional so content can
   * be drafted before its video is picked; validated to belong to the same
   * organization when it is set.
   */
  videoId?: string;
  /**
   * The lesson notes, as a TipTap/ProseMirror document (`{ type: 'doc', … }`)
   * rather than an HTML string: the frontend renders the tree directly, so
   * author-supplied markup is never handed to `dangerouslySetInnerHTML`.
   */
  notes?: Record<string, unknown>;
  /** 1-based order inside the section. Sparse: gaps are legal. */
  position: number;
  /**
   * Counters kept on the row rather than counted on read: a content page shows
   * all three, and counting them would otherwise be a query each.
   */
  fileCount: number;
  favouriteCount: number;
  commentCount: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A file attached to a piece of content. Its own table rather than an array on
 * the content, so adding or removing one is a single item write that cannot
 * race with an edit to the notes beside it.
 */
export interface ContentFile {
  /** Partition key. */
  contentId: string;
  /** ULID, the sort key — and the part of the S3 key that makes it unique. */
  fileId: string;
  /** Original file name, for display and for the download's name. */
  name: string;
  /** S3 key: contents/{contentId}/{fileId}/{name} */
  key: string;
  /** MIME type recorded at upload, and sent back with the download. */
  contentType: string;
  size?: number;
  /** Cognito `sub` of the user who attached it. */
  uploadedBy: string;
  createdAt: number;
}

/** What a piece of content is called when a learner is looking at it. */
export type FavouriteTargetType = 'CONTENT' | 'COMMENT' | 'LOOP';

export const FAVOURITE_TARGET_TYPES: FavouriteTargetType[] = ['CONTENT', 'COMMENT', 'LOOP'];

/**
 * One learner's favourite, over a piece of content or over a single comment.
 *
 * Both kinds live in one table because the relation is the same one — a user
 * marks a target — and because the learner's own list is then a single query
 * rather than a merge of two.
 */
export interface Favourite {
  /** Cognito `sub` of the learner. Partition key. */
  userId: string;
  /**
   * Sort key: `CONTENT#<contentId>` or `COMMENT#<commentId>`. Prefixing the id
   * with its type keeps the two kinds in one key space with no collision, and
   * groups a learner's list by kind.
   */
  targetKey: string;
  targetType: FavouriteTargetType;
  /** The contentId or commentId, without the prefix. */
  targetId: string;
  /**
   * The content a favourited comment or loop hangs off, so it can be read back:
   * a comment is keyed by content *and* comment id, and a loop's key needs the
   * content it belongs to as well.
   */
  contentId?: string;
  /**
   * Who owns a favourited loop. A loop is keyed by its owner and its id, so a
   * like has to record whose loop it was in order to reach it.
   */
  targetOwnerId?: string;
  createdAt: number;
}

/** A favourite together with what it points at, when that still exists. */
export interface FavouriteEntry extends Favourite {
  content?: Content;
  comment?: Comment;
  loop?: ContentLoop;
}

/**
 * A piece of content a learner has put in their learning playlist. Private to
 * that learner — a playlist is what you mean to watch, not a public signal.
 */
export interface PlaylistItem {
  /** Cognito `sub` of the learner. Partition key. */
  userId: string;
  /** Sort key. */
  contentId: string;
  addedAt: number;
}

/** A playlist entry together with the content it points at, when it exists. */
export interface PlaylistEntry extends PlaylistItem {
  content?: Content;
}

/**
 * A comment on a piece of content, or a reply to one.
 *
 * Threads are two levels deep on purpose: a reply to a reply keeps the same
 * top-level `parentId` and records who it answers in `replyToId`. That is what
 * the interfaces people already use do, and it means a content's whole
 * discussion is one query with no recursive assembly.
 */
export interface Comment {
  /** Partition key: the content being discussed. */
  contentId: string;
  /** Sort key. ULID, so the key order is the order they were written in. */
  commentId: string;
  /** Denormalized from the content, so a comment authorizes in one hop. */
  organizationId: string;
  /** Cognito `sub` of the author. */
  authorId: string;
  /** The author's name as it was when they wrote it. */
  authorName: string;
  /** 1–2000 characters. Emptied when the comment is deleted. */
  body: string;
  /** The top-level comment this belongs to. Absent on a top-level comment. */
  parentId?: string;
  /** The comment this one answers, when it is a reply to a reply. */
  replyToId?: string;
  /** Replies directly under this comment. Always 0 on a reply. */
  replyCount: number;
  favouriteCount: number;
  editedAt?: number;
  /**
   * Set instead of removing the row when a comment that has replies is deleted,
   * so the replies keep their parent. The body is emptied at the same time.
   */
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A comment as the API hands it out: the row, plus what the caller has done
 * with it.
 *
 * The favourite travels with the comment rather than being asked about per row,
 * so a discussion can be drawn with its hearts in the right state from the one
 * request that read it — the same reason a loop carries `likedByMe`.
 */
export interface ApiComment extends Comment {
  favourited: boolean;
}

/** A top-level comment and its replies, in the order they were written. */
export interface CommentThread {
  comment: ApiComment;
  replies: ApiComment[];
}

/** What the caller themselves has done with a piece of content. */
export interface ContentViewerState {
  favourited: boolean;
  inPlaylist: boolean;
  /** Marked as done by this learner. */
  completed: boolean;
}

/**
 * A lesson a learner has marked as done.
 *
 * Progress, and nothing more: it records that somebody finished something, not
 * that they were assessed on it or that anyone checked. Marking a lesson done is
 * the learner's own business, which is why they can undo it as easily as they
 * did it.
 */
export interface LessonCompletion {
  /** Cognito `sub` of the learner. Partition key. */
  userId: string;
  /**
   * Sort key: `{spaceId}#{contentId}`. One partition per learner, so what they
   * have finished in a course is a single `begins_with` query — which is what a
   * progress bar over a course needs, and what a per-lesson lookup is built from.
   */
  spaceKey: string;
  spaceId: string;
  contentId: string;
  completedAt: number;
}

/**
 * A named stretch of a lesson's video, kept by the learner who made it — the
 * piece of a lesson worth hearing again.
 *
 * Boundaries are milliseconds rather than second-and-line pairs because they are
 * what a player seeks by: the line numbers a reader recognises are derivable
 * from the transcript, and a loop should survive that transcript being re-cut.
 */
export interface ContentLoop {
  /** Cognito `sub` of the learner who made it. Partition key. */
  userId: string;
  /**
   * Sort key: `{contentId}#{loopId}`. One partition per learner, so a lesson's
   * loops are a single `begins_with` query rather than a filter over everything
   * they have ever looped.
   */
  loopKey: string;
  contentId: string;
  /** ULID, the loop's own id. */
  loopId: string;
  /** 1–60 characters, whitespace collapsed. */
  name: string;
  /** Accent colour, `#rrggbb`. Absent means the UI derives one. */
  color?: string;
  /** Start of the loop, in milliseconds from the beginning of the video. */
  startMs: number;
  /** End of the loop, in milliseconds. Always after `startMs`. */
  endMs: number;
  /**
   * How many people have liked it. Kept on the row rather than counted on read,
   * for the same reason a comment's favourites are: the list shows it for every
   * loop at once.
   */
  likeCount: number;
  createdAt: number;
  updatedAt: number;
}
