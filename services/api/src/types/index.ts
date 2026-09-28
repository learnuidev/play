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
  /**
   * Whether the course is listed in the marketplace catalog.
   *
   * Absent means private, which is what every course is until its author says
   * otherwise: publishing is a decision, not a default, and a course written
   * for one team should not appear in a public catalog because nobody thought
   * to hide it.
   */
  listed?: boolean;
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

/**
 * A course invitation addressed to the caller's own email address, as the API
 * hands it out: the offer, and enough of the course to decide about it.
 *
 * No membership is involved — the caller has none yet, which is the whole point
 * — so this is not the roster shape. The organization is named because a course
 * is a course *from* somewhere, and an offer with no context is one nobody can
 * weigh.
 */
export interface MySpaceInvitation {
  spaceId: string;
  spaceTitle: string;
  orgId: string;
  organizationName: string;
  role: SpaceMemberRole;
  invitedBy?: string;
  invitedAt: number;
}

/**
 * A course the caller is in, as their own list reads it.
 *
 * The organization's name travels with it because a course member need not be a
 * member of the organization around it: the course list is then the only thing
 * they can see, and "Introduction to Film" with no indication of where it came
 * from is half a name.
 */
export interface MyCourse {
  space: Space;
  role: SpaceMemberRole;
  organizationName: string;
}

/**
 * How far one learner has got in one course.
 *
 * The lesson they should open next is the first one in the course's own order
 * they have not finished, or the first lesson again once they have finished them
 * all. It is absent for a course with nothing published, which is the one case
 * with no lesson to open — a card that would otherwise offer a link to nowhere
 * can tell the two apart.
 *
 * The counts are read against the lessons *still published*: a lesson somebody
 * finished and its author later deleted is not part of what they have got
 * through, and counting it would report a course as more finished than it is.
 */
export interface CourseProgress {
  spaceId: string;
  /** How many lessons the course has published. */
  lessonCount: number;
  /** How many of them this learner has finished. */
  completedCount: number;
  nextContentId?: string;
}

export interface ListMyProgressResponse {
  courses: CourseProgress[];
}

/**
 * One course's progress, with the finished lessons named.
 *
 * The ids travel only on the course's own read: an outline draws a tick per row,
 * and it needs to know which rows — while a list of courses needs the numbers
 * and nothing else, and a hundred lesson ids per course would be paid for on
 * every card.
 */
export interface SpaceProgressResponse extends CourseProgress {
  completedContentIds: string[];
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
 * How a person is attached to a course.
 *
 * An organization's roles answer "what may you change in this organization";
 * these answer "what are you to this course", which is a different question with
 * a different answer: a viewer of the organization can be the instructor of one
 * course and a student in the next.
 *
 * - `STUDENT`    — taking the course. The people a course's student count is.
 * - `ASSISTANT`  — helping run it: sees the roster, reads everything.
 * - `INSTRUCTOR` — runs it: the same as an assistant, and named as the owner.
 */
export type SpaceMemberRole = 'STUDENT' | 'ASSISTANT' | 'INSTRUCTOR';

export const SPACE_MEMBER_ROLES: SpaceMemberRole[] = ['STUDENT', 'ASSISTANT', 'INSTRUCTOR'];

/**
 * A membership of a course.
 *
 * Keyed by the course and the person, exactly like an organization membership,
 * so "who is in this course" is one query rather than a filter over the
 * organization. Deliberately *not* the organization's roster: a course is taken
 * by people who may have no business in the organization around it, which is
 * what makes a course invitation an address rather than a membership.
 */
export interface SpaceMember {
  /** Partition key: the course. */
  spaceId: string;
  /**
   * Sort key: the Cognito `sub` — or, while `status` is `INVITED`, the email
   * address the invitation was sent to. Accepting rewrites the row under the
   * real `sub`, so an invitation is never an identity.
   */
  userId: string;
  /** Denormalized from the space, so a member authorizes in one hop. */
  organizationId: string;
  role: SpaceMemberRole;
  status: OrgMemberStatus;
  /** Email of the member, when known. */
  email?: string;
  /** The address the invitation named. Only ever on an `INVITED` row. */
  invitedEmail?: string;
  /** Cognito `sub` of whoever added them. */
  invitedBy?: string;
  /** When the membership began, or when the invitation was sent. */
  joinedAt: number;
}

/**
 * The links a person may put on their profile, as they are stored.
 *
 * Keys and list mirror `@play/types`, and the values are absolute URLs, which is
 * what the marketplace renders them as. Nothing here is required, and an absent
 * link is absent rather than empty — a row with four keys and three of them `''`
 * is a row that has to be cleaned before it can be read.
 */
export type SocialKey = 'website' | 'x' | 'linkedin' | 'youtube' | 'github';

export const SOCIAL_KEYS: SocialKey[] = ['website', 'x', 'linkedin', 'youtube', 'github'];

export type ProfileSocials = Partial<Record<SocialKey, string>>;

/**
 * The row behind a person's own screen: their name, their face, and what they
 * say about themselves.
 *
 * Keyed by the Cognito `sub` — the same identity every membership in this
 * service is keyed by — and nothing here is a permission: what somebody may do
 * in an organization or a course is in those tables, and always was. This is
 * only what to call them and what to draw beside the name.
 *
 * It is deliberately separate from the identity provider. A pool attribute is
 * the provider's to write and would need `cognito-idp` on the shared Lambda
 * role, while the one thing this row exists to fix is that a person could not
 * rename themselves: `displayNameOf` reads a claim, and a claim belongs to
 * whoever federated the sign-in.
 */
export interface ProfileRow {
  /** Partition key: the Cognito `sub`. */
  userId: string;
  /** What they call themselves. Never empty — see `toPublicInstructor`. */
  name: string;
  bio: string;
  socials: ProfileSocials;
  /**
   * Where the photo lives in the videos bucket, under `people/{userId}/`.
   * Timestamped per upload, so replacing one writes a new object and CloudFront
   * never has to be invalidated.
   */
  photoKey?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Somebody who teaches, as the marketplace is allowed to see them.
 *
 * The public half of a profile: a name, a face, a sentence and their links. No
 * email, no timestamps, and no id beyond the `sub` that names them in a link —
 * none of which a course page has any use for.
 */
export interface PublicInstructor {
  userId: string;
  name: string;
  bio: string;
  socials: ProfileSocials;
  /** A signed URL, minted per response, when they have a photo. */
  photoUrl?: string;
}

/** One instructor, and every listed course they teach. */
export interface InstructorResponse {
  instructor: PublicInstructor;
  courses: CatalogCourse[];
}

/**
 * A group of a course's members: a cohort.
 *
 * Cohorts are how a course runs for more than one intake at once — a September
 * group and a January one, or a team inside a company — without the course being
 * copied. Membership is many-to-many and lives in its own table, because a
 * cohort is a label a member may wear several of and because adding somebody to
 * one must not rewrite the membership row beside it.
 */
export interface Cohort {
  /** ULID, the table key. */
  cohortId: string;
  /** The course it groups members of. A cohort never exists outside one. */
  spaceId: string;
  /** Denormalized from the space, for the same reason as on a member. */
  organizationId: string;
  /** Required, 2–80 characters (whitespace collapsed). */
  name: string;
  /** Optional, ≤ 500 characters. */
  description: string;
  /** When this cohort's run begins, epoch ms. Absent means no schedule. */
  startAt?: number;
  /** When it ends, epoch ms. Absent means open-ended. */
  endAt?: number;
  /** Members in it, kept on the row so a list can show it without a query each. */
  memberCount: number;
  /** Cognito `sub` of the user who created it. */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** One membership of a cohort: the course member it groups. */
export interface CohortMember {
  /** Partition key: the cohort. */
  cohortId: string;
  /** Sort key: the course member's `sub`. */
  userId: string;
  /** Denormalized, so a cohort membership authorizes without walking up. */
  spaceId: string;
  /** Cognito `sub` of the user who put them in it. */
  addedBy: string;
  addedAt: number;
}

/** A cohort together with the members in it, as the page reads it. */
export interface CohortWithMembers extends Cohort {
  memberIds: string[];
}

/**
 * What a reward *is*, which is also how it is handed over.
 *
 * - `COUPON`    — a code, generated per grant, that a store or a checkout takes.
 * - `GIFT_CARD` — the same code, for a stated amount and currency.
 * - `CUSTOM`    — something a course does by hand; the reward carries what to do.
 */
export type RewardKind = 'COUPON' | 'GIFT_CARD' | 'CUSTOM';

export const REWARD_KINDS: RewardKind[] = ['COUPON', 'GIFT_CARD', 'CUSTOM'];

/**
 * What a learner has to do to earn a reward.
 *
 * - `LESSONS_COMPLETED` — a number of the course's lessons marked done.
 * - `PERCENT_COMPLETE`  — a share of the course's lessons, so the same reward
 *   reads the same on a ten-lesson course and a hundred-lesson one.
 */
export type RewardMilestoneType = 'LESSONS_COMPLETED' | 'PERCENT_COMPLETE';

export const REWARD_MILESTONE_TYPES: RewardMilestoneType[] = [
  'LESSONS_COMPLETED',
  'PERCENT_COMPLETE',
];

export interface RewardMilestone {
  type: RewardMilestoneType;
  /** Lessons, or a percentage of the course. Always ≥ 1. */
  value: number;
}

/**
 * A reward a course offers for reaching a milestone.
 *
 * The definition is the course's; the grants are the learners'. Keeping them
 * apart is what makes a reward editable after it has been earned — raising the
 * bar for the next person does not take back what somebody already holds.
 */
export interface SpaceReward {
  /** ULID, the table key. */
  rewardId: string;
  /** The course that offers it. */
  spaceId: string;
  /** Denormalized from the space, for the same reason as on a member. */
  organizationId: string;
  /** Required, 2–80 characters (whitespace collapsed). */
  name: string;
  /** Optional, ≤ 500 characters. */
  description: string;
  kind: RewardKind;
  milestone: RewardMilestone;
  /** Face value in cents. Only meaningful on a gift card. */
  amountCents?: number;
  /** ISO-4217 code, e.g. `USD`. Only meaningful on a gift card. */
  currency?: string;
  /** Prefix generated coupon codes carry, e.g. `FILM101`. */
  codePrefix?: string;
  /** What to do to claim it, for a reward a course hands over by hand. */
  instructions?: string;
  /**
   * How many may be granted in total. Absent means as many as are earned —
   * which is what a milestone reward usually is, since the milestone is the
   * limit.
   */
  grantLimit?: number;
  /** Whether it is currently being earned. A paused reward is kept, not deleted. */
  active: boolean;
  /** Grants made, kept on the row so the list shows it without a query each. */
  grantCount: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Where a grant has got to.
 *
 * A grant is the record that somebody holds a reward: it is written when a
 * milestone is reached or when an instructor hands one over, and it stops being
 * in force either because it was used (`REDEEMED`) or because it was taken back
 * (`REVOKED`).
 */
export type RewardGrantStatus = 'ISSUED' | 'REDEEMED' | 'REVOKED';

export const REWARD_GRANT_STATUSES: RewardGrantStatus[] = ['ISSUED', 'REDEEMED', 'REVOKED'];

/** One reward, held by one member. */
export interface RewardGrant {
  /** Partition key: the reward. */
  rewardId: string;
  /**
   * Sort key: the member's Cognito `sub`. A reward is held once per person,
   * which the key says for free — reaching a milestone twice does not issue two
   * coupons.
   */
  userId: string;
  /** Denormalized, so a course's grants are one query and a grant authorizes. */
  spaceId: string;
  organizationId: string;
  /** The code the member redeems, on the kinds that carry one. */
  code?: string;
  status: RewardGrantStatus;
  /**
   * Who issued it: an instructor's `sub`, or `SYSTEM` when a milestone did.
   * Kept because "who gave this out" is the first question asked of a reward
   * somebody says they did not earn.
   */
  grantedBy: string;
  /** What the member had done at the moment it was granted, as the proof. */
  progress?: number;
  /** Free text an instructor may attach, e.g. where a gift card was sent. */
  note?: string;
  grantedAt: number;
  redeemedAt?: number;
  updatedAt: number;
}

/** A grant together with the member it belongs to, as a list reads it. */
export interface RewardGrantWithMember extends RewardGrant {
  /** The member's email, when the course roster knows one. */
  email?: string;
}

/**
 * A reward the caller holds, with everything needed to act on it: the grant, the
 * reward's own definition, and where it came from.
 *
 * A code on its own is a string nobody can do anything with; "10% off, from
 * Introduction to Film, for finishing five lessons" is a reward.
 */
export interface MyReward extends RewardGrant {
  reward: SpaceReward;
  spaceTitle: string;
  orgId: string;
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

/**
 * The marketplace catalog.
 *
 * A course is *listed* when its author says so, and a listed course is what
 * somebody who has never heard of the organization behind it can find, read
 * about, and register for. Everything here is public: it is served without a
 * token, to a visitor who has not signed in, so it carries what a course looks
 * like from the outside and nothing about the people in it.
 */

/**
 * The part of a course a card draws.
 *
 * Split out from `Space` because the studio's card and the marketplace's card
 * are the same card, and the marketplace must not have to be handed a whole
 * `Space` — with its `createdBy` and its internal timestamps — to draw one.
 * A `Space` satisfies this structurally; so does a catalog course.
 */
export interface CourseSummary {
  spaceId: string;
  title: string;
  description: string;
  type: SpaceType;
  /** Custom accent colour, `#rrggbb`. Absent means the UI derives one. */
  color?: string;
  startAt?: number;
  dripIntervalDays?: number;
  thumbnailKey?: string;
}

/**
 * A course as the catalog lists it: the course, who it is from, and how much of
 * it there is.
 *
 * The counts are read rather than stored — a section and a lesson are each one
 * `COUNT` query over an index the course already has — because a counter that
 * is maintained by hand is a number that eventually lies about the course on
 * the page whose whole job is to describe it.
 */
export interface CatalogCourse extends CourseSummary {
  organizationId: string;
  organizationName: string;
  /**
   * A signed URL for the course's cover, when it has one.
   *
   * Served with the course rather than fetched from the thumbnail endpoint,
   * which wants a token: a catalog read by people who have not signed in cannot
   * use an endpoint that refuses them, and a card with no cover is a card
   * nobody clicks.
   */
  thumbnailUrl?: string;
  sectionCount: number;
  lessonCount: number;
  studentCount: number;
  createdAt: number;
}

export interface ListCatalogResponse {
  courses: CatalogCourse[];
  nextToken?: string;
}

/**
 * One lesson of a listed course, as the catalog shows it.
 *
 * `hasVideo` rather than `videoId`: the outline says what is in the course, and
 * a video's id is not the reader's business until they are a member — the
 * stream is behind its own authorization.
 */
export interface CatalogLesson {
  contentId: string;
  title: string;
  hasVideo: boolean;
}

export interface CatalogSection {
  sectionId: string;
  title: string;
  lessons: CatalogLesson[];
}

/** One listed course in full: what it is, who teaches it, and what is in it. */
export interface CatalogCourseResponse {
  course: CatalogCourse;
  sections: CatalogSection[];
  instructors: PublicInstructor[];
}

/**
 * API keys — how somebody outside this product calls the API.
 *
 * Everything else in this service is called by one of our own two apps, which
 * sign in with Cognito and carry a token minted for a person. A key is the other
 * kind of caller: a script, a partner's backend, a customer's data pipeline —
 * something that has no person behind it and cannot complete a sign-in.
 *
 * The row is what is *stored*, so it carries the hash and never the secret. The
 * secret exists once, in the response to the request that created it, and there
 * is no way to read it back: the only thing this service keeps is a SHA-256 of
 * it, which is what makes a leak of the table a leak of nothing usable.
 */
export interface ApiKeyRecord {
  /** ULID, the table key. Public: it identifies the key and revokes it. */
  keyId: string;
  /** What the key is for, as its owner named it. */
  name: string;
  /**
   * The first characters of the secret, e.g. `play_sk_9f2c1a`. Kept so a list
   * can show which key is which — several keys for one account look identical
   * without it, and the alternative is storing the secret itself.
   */
  prefix: string;
  /**
   * Hex SHA-256 of the whole secret. The lookup a presented key is resolved by,
   * and the only representation of the key this service holds.
   */
  keyHash: string;
  /** Cognito `sub` of whoever created it. */
  userId: string;
  /** Their email at the time, so an admin's list can say who made a key. */
  userEmail?: string;
  /**
   * The organization the key was made for, when its creator named one.
   *
   * It is what an admin's list reads — "the keys belonging to this
   * organization" — and it is also the key's *reach*: a key scoped to an
   * organization may read that organization's courses, whether or not they are
   * published. Absent means the key reaches only the public catalog.
   */
  organizationId?: string;
  /** The organization's name at creation, so a list needs no second read. */
  organizationName?: string;
  createdAt: number;
  /** The last time the key was presented, written at most every few minutes. */
  lastUsedAt?: number;
}

/**
 * A key as its own owner sees it, and as the API hands it out.
 *
 * The hash is not on it, and neither is the owner: the caller *is* the owner,
 * which is why the same shape is what the library in each app draws from.
 */
export interface ApiKey {
  keyId: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  organizationId?: string;
  organizationName?: string;
}

/**
 * A key as an organization's admin sees it: the key, and who made it.
 *
 * The extra two fields are the point of the shape being separate at all — a
 * roster of keys nobody can attribute is a roster nobody can act on.
 */
export interface OrganizationApiKey extends ApiKey {
  userId: string;
  userEmail?: string;
}

/**
 * What a caller behind `/v1` is allowed to act as, resolved from the request.
 *
 * Two kinds of credential reach `/v1`, and this is the one shape they are
 * resolved into. An API key is the older one: a credential a person made for a
 * script, which acts as them and reaches a fixed, chosen slice. An OAuth access
 * token is the newer one: a credential minted because a person *authorized
 * somebody else's app*, which acts as them and reaches exactly the scopes they
 * agreed to on a consent screen.
 *
 * The two are one type rather than two paths through every handler because the
 * questions a handler asks are the same either way — who is this, and what may
 * they reach. What differs is small and worth being able to see at a glance:
 * a key can be *made for an organization* and reaches that organization's
 * courses outright (`organizationId`), and an OAuth caller is an app with a
 * client id, which is what a response tells the caller about when it says who
 * they are.
 */
export type ApiCaller = ApiKeyCaller | OAuthCaller;

/** A caller holding an API key. */
export interface ApiKeyCaller {
  kind: 'key';
  keyId: string;
  /** Cognito `sub` of the key's owner — the identity the key acts as. */
  userId: string;
  /** The organization the key was made for, when it has one. */
  organizationId?: string;
  /** What the key reaches. See `lib/oauth-scopes`. */
  scopes: ApiScope[];
}

/** A caller holding an OAuth access token that a person authorized. */
export interface OAuthCaller {
  kind: 'oauth';
  /** ULID of the app the token was issued to. */
  appId: string;
  clientId: string;
  /** Cognito `sub` of the person who authorized the app — who it acts as. */
  userId: string;
  /** The scopes the token was issued with, which the person agreed to. */
  scopes: ApiScope[];
}

/**
 * A scope: one thing an app may be allowed to do on somebody's behalf.
 *
 * Deliberately coarse, and deliberately few. A scope is a sentence a person
 * reads on a consent screen and agrees to, not an endpoint name: an app that
 * asked for `courses:read` and got `catalog:read`, `sections:read` and
 * `lessons:index` would be asking somebody to agree to three things they cannot
 * tell apart.
 *
 * The catalogue itself — which scopes exist, what each one reaches, and which
 * ones a new app starts with — is `lib/oauth-scopes`, and it is the one place
 * that maps a scope onto the routes it opens.
 */
export type ApiScope =
  | 'profile:read'
  | 'courses:read'
  | 'lessons:read'
  | 'lessons:stream'
  | 'organization:courses:read'
  | 'learning:read'
  | 'learning:write'
  | 'comments:write';

/**
 * An OAuth app: somebody's client, registered by one of our people.
 *
 * The row is what is *stored*, so it carries the hash of the client secret and
 * never the secret — the same rule the keys table follows, for the same reason:
 * a leak of this table is then a leak of nothing anybody can authenticate with.
 * The secret exists once, in the response that made it (or the one that rotated
 * it), and there is no way to read it back.
 *
 * A **public** client — a browser app, a desktop app, a CLI — has no secret at
 * all: nothing shipped to a machine somebody else controls can keep one, so
 * storing a hash of something that is not secret would be pretending. A public
 * client authenticates with its `clientId` and proves itself with PKCE instead,
 * which is the same proof a confidential client gives and is required of both.
 */
export interface OAuthAppRecord {
  /** ULID, the table key. Public: it addresses the app everywhere in the app's own UI. */
  appId: string;
  /**
   * What a client authenticates *as*, e.g. `play_app_9f2c1a4b…`.
   *
   * Public by definition — it travels in an authorization URL a browser can see
   * — which is why it is a name rather than a secret, and why the secret beside
   * it exists.
   */
  clientId: string;
  /**
   * Hex SHA-256 of the client secret. Absent on a public client, and its
   * absence *is* the flag: a row either has a secret to check or has none, and
   * an `isPublic` boolean beside a hash that may or may not be there is two
   * facts that can disagree.
   */
  clientSecretHash?: string;
  /** The opening characters of the secret, e.g. `play_cs_9f2c1a`. For a list. */
  secretPrefix?: string;
  /** What the app is called, as it is shown on the consent screen. */
  name: string;
  /** The sentence under the name on the consent screen. */
  description: string;
  /** Where the app lives. Shown on the consent screen, and where its name links. */
  homepageUrl?: string;
  /** The app's mark, shown on the consent screen. */
  logoUrl?: string;
  /**
   * Where the app is allowed to be sent back to, exactly.
   *
   * Matched as whole strings rather than by prefix: a redirect URI is where a
   * person is handed a code that acts as them, so `https://app.example/cb` and
   * `https://app.example.evil.com/cb` must not be the same answer to the same
   * question. A client that needs several registers several.
   */
  redirectUris: string[];
  /** The most this app may ever ask for. A consent screen offers a subset. */
  scopes: ApiScope[];
  /** Cognito `sub` of whoever registered it. */
  userId: string;
  /** Their email at the time, so a support question can be answered by a person. */
  userEmail?: string;
  createdAt: number;
  updatedAt: number;
}

/** An app as its owner sees it. No hash, and no owner: the caller is the owner. */
export interface OAuthApp {
  appId: string;
  clientId: string;
  name: string;
  description: string;
  homepageUrl?: string;
  logoUrl?: string;
  redirectUris: string[];
  scopes: ApiScope[];
  /** A public client has a client id and no secret. See `OAuthAppRecord`. */
  isPublic: boolean;
  /** The opening characters of the secret, for a list. Absent on a public client. */
  clientSecretPrefix?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * An app as somebody who is not its owner sees it.
 *
 * What the consent screen draws — the name, the sentence under it, where it
 * lives, its mark — and nothing else. The redirect URIs, the registered scopes
 * and the secret's hash are the owner's business; a person deciding whether to
 * trust an app needs the four fields here and none of the others.
 */
export interface OAuthAppSummary {
  appId: string;
  clientId: string;
  name: string;
  description: string;
  homepageUrl?: string;
  logoUrl?: string;
}

/**
 * One person's authorization of one app: a *grant*.
 *
 * Keyed by the person and the app together (`userId`, `appId`), because that
 * pair is what a grant is — authorizing the same app twice replaces the first
 * answer rather than stacking a second one, and the scopes on the row are the
 * answer given most recently.
 *
 * It is the row a person reads when they ask "what have I let in", and the row
 * disconnecting deletes, taking the app's tokens with it.
 */
export interface OAuthGrantRecord {
  /** Cognito `sub` of the person who authorized the app. Table key. */
  userId: string;
  /** The app they authorized. Sort key. */
  appId: string;
  /**
   * What they agreed to.
   *
   * The answer given most recently, rather than the union of every answer: a
   * person who authorizes an app for less than they did last time has narrowed
   * it, and a row that kept the wider set would be a consent screen that cannot
   * be walked back.
   */
  scopes: ApiScope[];
  createdAt: number;
  /** When the scopes on this row were last agreed to. */
  updatedAt: number;
  /**
   * The last time the app used the grant, accurate to about five minutes.
   *
   * On the grant rather than on each token: the grant is what a person reads and
   * what a person revokes, and a timestamp per token would describe a credential
   * nobody lists.
   */
  lastUsedAt?: number;
}

/** One app a person has authorized, as the screen that lists them reads it. */
export interface OAuthConnection {
  appId: string;
  clientId: string;
  name: string;
  description: string;
  homepageUrl?: string;
  logoUrl?: string;
  /** What the person agreed to. */
  scopes: ApiScope[];
  /** When they first authorized it. */
  createdAt: number;
  /** When they last re-authorized it, which is also when its scopes last changed. */
  updatedAt: number;
  lastUsedAt?: number;
}

/**
 * An authorization code, waiting to be exchanged for tokens.
 *
 * Stored by hash for the same reason a key is: the table is a list of live
 * credentials, and the only thing that ever needs the plaintext is the client
 * that was just handed it. Single-use — redeeming one deletes it — and short
 * lived, because its whole purpose is to survive one redirect through a browser.
 */
export interface OAuthCodeRecord {
  /** Hex SHA-256 of the code. The table key. */
  codeHash: string;
  clientId: string;
  appId: string;
  /** Who authorized it. The identity the tokens it becomes will act as. */
  userId: string;
  /**
   * The redirect URI the code was issued for, so the exchange can require the
   * same one. A code that is replayed to a different URI is a code somebody
   * moved, and the two must be the same answer to RFC 6749.
   */
  redirectUri: string;
  /**
   * The S256 challenge the code is bound to.
   *
   * Required of every client, public or confidential: a code travels through a
   * browser, a redirect and (usually) a log, and PKCE is what makes a code that
   * leaked on the way useless without the verifier that never left the client.
   */
  codeChallenge: string;
  /** The scopes the person agreed to. */
  scopes: ApiScope[];
  createdAt: number;
  /** Epoch seconds, which is also the table's TTL attribute. */
  expiresAt: number;
}

/**
 * An access or refresh token, stored by hash.
 *
 * One table for both kinds, because they are the same row with a different
 * lifetime and a different job: an access token is presented to `/v1` and proves
 * a grant is still in force, and a refresh token is presented to the token
 * endpoint and asks for a new one. What they share is everything that matters to
 * revocation — the app, the person, the scopes — and revoking a grant has to
 * take both.
 */
export interface OAuthTokenRecord {
  /** ULID. The table key, and never anything a client sees. */
  tokenId: string;
  /** Hex SHA-256 of the token. What the lookup is by. */
  tokenHash: string;
  kind: 'access' | 'refresh';
  clientId: string;
  appId: string;
  userId: string;
  /**
   * `userId#appId`: the grant this token belongs to, as one attribute.
   *
   * Synthesized rather than derived, because DynamoDB indexes an attribute and
   * not an expression — and revocation is by grant, so "every token this
   * authorization produced" has to be a query rather than a scan.
   */
  grantKey: string;
  scopes: ApiScope[];
  createdAt: number;
  /** Epoch seconds, which is also the table's TTL attribute. */
  expiresAt: number;
}

/**
 * A lesson the caller has saved, as `/v1` lists it.
 *
 * The `spaceTitle` comes with it rather than being looked up per row: a list of
 * saved lessons that says "Lesson 3" five times and never says which course any
 * of them belongs to is a list somebody has to open five links to read. It costs
 * one batch read of the courses involved.
 */
export interface ApiFavouriteLesson {
  contentId: string;
  title: string;
  spaceId: string;
  spaceTitle: string;
  /** 1-based order inside its section, which is where the lesson sits in a course. */
  position: number;
  /** Whether it has a video, so a list can offer to play it. */
  hasVideo: boolean;
  favouritedAt: number;
}

/** One lesson the caller has finished. */
export interface ApiCompletion {
  contentId: string;
  spaceId: string;
  completedAt: number;
}

/**
 * The caller's own learning record: what they have saved and what they have
 * finished.
 *
 * One response rather than two routes, because the two questions are asked
 * together — a classroom drawing a tick and a heart beside every lesson wants
 * both answers in one read — and because both are the person's own list, bounded
 * by what they have done rather than by what the catalog holds. Neither is
 * paged, for the same reason `GET /v1/courses/{spaceId}/sections` is not: it is
 * one person's own activity, and a page of it would be a page of their history
 * with the rest hidden.
 *
 * Behind `learning:read`, which is deliberately separate from `learning:write`:
 * seeing what somebody has saved is not the same permission as changing it.
 */
export interface ApiLearningResponse {
  favourites: ApiFavouriteLesson[];
  completed: ApiCompletion[];
}

/** The answer to marking a lesson done, or taking it back off the list. */
export interface ApiCompletionResponse {
  completed: boolean;
  /** Present when `completed` is true. Epoch milliseconds. */
  completedAt?: number;
}

/** The answer to saving a lesson, or unsaving it. */
export interface ApiFavouriteResponse {
  favourited: boolean;
  /**
   * How many people have the lesson saved, after this call.
   *
   * A count rather than the person's own state alone, because a lesson page
   * draws both — and it arrives here rather than from a second read, since this
   * request has just changed it.
   */
  favouriteCount: number;
}

/** What `POST /v1/lessons/{contentId}/comments` answers with. */
export interface ApiCommentResponse {
  comment: ApiComment;
}

/**
 * A lesson as `/v1` hands it out — the pieces somebody building the classroom
 * somewhere else needs. The same shapes the shared package declares, kept here
 * because the API's own types describe what it serializes; see docs/workspace.md.
 */
export interface ApiLesson {
  contentId: string;
  spaceId: string;
  sectionId: string;
  title: string;
  notes?: Record<string, unknown>;
  videoId?: string;
  thumbnailUrl?: string;
  fileCount: number;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface ApiLessonStream {
  videoId: string;
  manifestUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface ApiSubtitleTrack {
  language: string;
  label: string;
  isSource: boolean;
  subtitleUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface ApiLessonAttachment {
  fileId: string;
  name: string;
  contentType: string;
  size?: number;
  url?: string;
  createdAt: number;
}

/**
 * What `GET /v1/me` answers: who the presented credential is.
 *
 * `kind` is the discriminator the two credentials are told apart by, and the two
 * shapes beside it are deliberately different rather than a lowest common
 * denominator: a key has a name, a prefix and an organization, and an app has a
 * client id and the scopes a person agreed to. A caller that asked "does this
 * work" is owed the answer in the terms of the thing it is holding.
 */
export interface ApiIdentityResponse {
  kind: 'key' | 'oauth';
  /** Present on a key. Absent on an OAuth access token. */
  key?: ApiKey;
  /** Present on an OAuth access token. Absent on a key. */
  oauth?: {
    app: OAuthAppSummary;
    scopes: ApiScope[];
    /** The same scopes as OAuth writes them, for a client that echoes them back. */
    scope: string;
  };
  owner: {
    /** Cognito `sub` of the person the credential acts as. */
    userId: string;
  };
  /** Every scope the credential holds. What the two above agree on. */
  scopes: ApiScope[];
}

/** One scope an app asked for, and whether the person has already agreed to it. */
export interface OAuthScopeGrant {
  scope: ApiScope;
  granted: boolean;
}

/**
 * What the consent screen's one read answers.
 *
 * A union rather than one shape plus a status code, because the two failures are
 * not interchangeable and neither is a server error: `ok: false` is a request
 * that may still be reported to the *client* by redirecting the browser to
 * `redirectUri`, and a 400 is a request that must be shown to the person instead
 * because nothing about it has been verified — see `describe-authorization`.
 */
export type OAuthAuthorizationRequestResponse =
  | {
      ok: true;
      app: OAuthAppSummary;
      scopes: OAuthScopeGrant[];
      /** Validated against the app's registered list. Safe to send a browser to. */
      redirectUri: string;
      state?: string;
      alreadyAuthorized: boolean;
    }
  | {
      ok: false;
      /** RFC 6749 §4.1.2.1 code, e.g. `invalid_scope`. */
      oauthError: string;
      message: string;
      redirectUri: string;
      state?: string;
    };
