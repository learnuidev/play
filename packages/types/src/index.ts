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
  /**
   * Whether the course is listed in the marketplace catalog.
   *
   * Absent means private, which is what every course is until its author says
   * otherwise.
   */
  listed?: boolean;
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

/** Editing what a course says about itself, from the overview tab. */
export interface UpdateSpacePayload {
  title?: string;
  description?: string;
  /** An empty string clears the accent colour back to one derived from the id. */
  color?: string;
  type?: SpaceType;
  /** A date-only string or epoch ms; only meaningful on a scheduled course. */
  startAt?: number | string;
  dripIntervalDays?: number;
  /** Whether the course appears in the marketplace catalog. */
  listed?: boolean;
}

/** What the overview's four cards read. */
export interface SpaceStats {
  students: number;
  sections: number;
  contents: number;
  /**
   * Always zero today: nothing in this API is a quiz yet. The tile is here so
   * the overview has its full shape when quizzes arrive.
   */
  quizzes: number;
}

export interface SpaceStatsResponse {
  stats: SpaceStats;
  /** Whether a count hit a read ceiling and is short of the real total. */
  truncated: boolean;
}

/**
 * What somebody is to a course.
 *
 * Not the organization's roles: an organization's viewer can be a course's
 * instructor, and a course is taken by people who are not in the organization at
 * all.
 */
export type SpaceMemberRole = 'STUDENT' | 'ASSISTANT' | 'INSTRUCTOR';

export const SPACE_MEMBER_ROLES: SpaceMemberRole[] = ['STUDENT', 'ASSISTANT', 'INSTRUCTOR'];

export const SPACE_MEMBER_ROLE_LABELS: Record<SpaceMemberRole, string> = {
  STUDENT: 'Student',
  ASSISTANT: 'Assistant',
  INSTRUCTOR: 'Instructor',
};

export const SPACE_MEMBER_ROLE_DESCRIPTIONS: Record<SpaceMemberRole, string> = {
  STUDENT: 'Taking the course — the people the student count is made of.',
  ASSISTANT: 'Helping run it: sees the roster and everything in the course.',
  INSTRUCTOR: 'Runs the course, and is named as the one who does.',
};

/** A membership of a course, as the API hands it out. */
export interface SpaceMemberApi {
  /** Cognito `sub`, or the invited address while the invitation is pending. */
  userId: string;
  role: SpaceMemberRole;
  /** The invitation has not been accepted, so the role is not in force yet. */
  pending: boolean;
  /** Sent to whoever may manage the roster, and to the invited person. */
  email?: string;
  /**
   * What they call themselves, when they have a profile.
   *
   * A roster used to be a list of ids — `Member a1b2c3` beside a circle with two
   * letters in it — which stops being readable the moment a course has more than
   * one person on it. The name and the photo come from the same profile the
   * marketplace reads, so a roster row and a course page cannot disagree about
   * who somebody is. Absent for a pending invitation, which has no account
   * behind it yet.
   */
  name?: string;
  /** A signed URL for that profile's photo, when they have one. */
  photoUrl?: string;
  isYou: boolean;
  /** This pending invitation is addressed to the signed-in user. */
  isInvitationForYou: boolean;
  invitedBy?: string;
  joinedAt: number;
}

export interface ListSpaceMembersResponse {
  members: SpaceMemberApi[];
  /** Whether the caller may invite, remove, or change roles. */
  canManage: boolean;
  /** Where an invitation to this course is claimed, for handing out by hand. */
  inviteUrl?: string;
  nextToken?: string;
}

export interface InviteSpaceMemberPayload {
  email: string;
  role: SpaceMemberRole;
}

export interface InviteSpaceMemberResponse {
  member: SpaceMemberApi;
  delivery: MailDelivery;
  inviteUrl: string;
}

/** Re-sending an outstanding course invitation, optionally correcting its role. */
export interface ResendSpaceInvitationResponse {
  member: SpaceMemberApi;
  delivery: MailDelivery;
  inviteUrl: string;
}

export interface SpaceMemberResponse {
  member: SpaceMemberApi;
}

/**
 * A course invitation addressed to the signed-in user's own email address,
 * wherever it came from: the offer, and enough of the course to decide about it.
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

export interface ListMySpaceInvitationsResponse {
  invitations: MySpaceInvitation[];
}

/**
 * The links a person may put on their profile.
 *
 * A fixed set rather than a list of {label, url}: the marketplace draws one row
 * of small links under a name, and a field anybody can label anything in is a
 * row that arrives as four words of somebody's own choosing. Five is what a
 * teaching profile actually uses — where their work is, where they write, where
 * they are reachable — and the ones nobody filled in are simply absent.
 */
export type SocialKey = 'website' | 'x' | 'linkedin' | 'youtube' | 'github';

export const SOCIAL_KEYS: SocialKey[] = ['website', 'x', 'linkedin', 'youtube', 'github'];

export const SOCIAL_LABELS: Record<SocialKey, string> = {
  website: 'Website',
  x: 'X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  github: 'GitHub',
};

/**
 * What the field asks for, as a placeholder.
 *
 * The stored value is an absolute URL, so the placeholder shows the whole shape
 * rather than a handle: a form that takes `@annaruiz` in one field and
 * `annaruiz.com` in the next is a form nobody can predict, and the profile is
 * rendered as a link in an app that does not know which platform it is pointing
 * at.
 */
export const SOCIAL_PLACEHOLDERS: Record<SocialKey, string> = {
  website: 'https://annaruiz.com',
  x: 'https://x.com/annaruiz',
  linkedin: 'https://linkedin.com/in/annaruiz',
  youtube: 'https://youtube.com/@annaruiz',
  github: 'https://github.com/annaruiz',
};

/** Only the links this person filled in. An empty object is a complete answer. */
export type ProfileSocials = Partial<Record<SocialKey, string>>;

/**
 * Who somebody is, as the person themselves sees it.
 *
 * This is the studio's own record of a person, not the identity provider's: the
 * name here is one they chose and can change, which is the whole reason it
 * exists. It is keyed by the Cognito `sub` that every membership in the product
 * already uses, and the account it belongs to owns it and nothing else.
 */
export interface Profile {
  userId: string;
  /** What to call them. Never empty: an account is named when it is first read. */
  name: string;
  bio: string;
  socials: ProfileSocials;
  /** Where their photo lives in the bucket. Absent means they have not set one. */
  photoKey?: string;
  /** A signed URL for that photo, minted per response, when they have one. */
  photoUrl?: string;
  updatedAt: number;
}

export const PROFILE_NAME_MIN_LENGTH = 2;
export const PROFILE_NAME_MAX_LENGTH = 80;
export const PROFILE_BIO_MAX_LENGTH = 500;
export const PROFILE_LINK_MAX_LENGTH = 200;

export interface ProfileResponse {
  profile: Profile;
}

/** Editing one's own profile. An absent field is left alone; `''` clears it. */
export interface UpdateProfilePayload {
  name?: string;
  bio?: string;
  socials?: ProfileSocials;
}

export interface UploadProfilePhotoResponse {
  profile: Profile;
  upload: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
}

/**
 * Somebody who teaches, as the marketplace is allowed to see them.
 *
 * The public half of a profile, and it is a *different shape* rather than a
 * trimmed `Profile` for the reason the catalog is a different shape from a
 * space: what a course page needs is a name, a face and a sentence, and the
 * person's own screen is the only one that gets to know their id, their
 * settings and when they last changed anything.
 *
 * `name` is never empty. An instructor who has never opened their profile is
 * named from what the API already holds about them, because a course page that
 * credits nobody credits nothing.
 */
export interface PublicInstructor {
  userId: string;
  name: string;
  bio: string;
  socials: ProfileSocials;
  photoUrl?: string;
}

export interface ListInstructorsResponse {
  instructors: PublicInstructor[];
}

/** One instructor, and everything they teach that is on the marketplace. */
export interface InstructorResponse {
  instructor: PublicInstructor;
  courses: CatalogCourse[];
}

/**
 * A course the caller is in.
 *
 * The organization's name travels with it because a course member need not be a
 * member of the organization around it: for a guest, the course list is the only
 * thing they can see, and a course with no indication of where it came from is
 * half a name.
 */
export interface MyCourse {
  space: Space;
  role: SpaceMemberRole;
  organizationName: string;
}

export interface ListMyCoursesResponse {
  courses: MyCourse[];
}

/**
 * Where a learner is up to in one of the courses they are in.
 *
 * `contentId` is the lesson they should open next: the first one in the course's
 * own order they have not finished, or the first lesson again once they have
 * finished them all. It is absent for a course with nothing published, which is
 * the one case with no lesson to open at all — a card that would otherwise
 * offer a link to nowhere can tell the two apart.
 */
export interface CourseNextLesson {
  spaceId: string;
  contentId?: string;
}

export interface ListNextLessonsResponse {
  courses: CourseNextLesson[];
}

/**
 * A group of a course's members — a September intake, a team, a tutorial group.
 *
 * A member may be in several: a cohort is a label they wear, not a container they
 * live in.
 */
export interface Cohort {
  cohortId: string;
  spaceId: string;
  organizationId: string;
  name: string;
  description: string;
  /** When its run begins, epoch ms. Absent means unscheduled. */
  startAt?: number;
  /** When it ends, epoch ms. Absent means open-ended. */
  endAt?: number;
  memberCount: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** A cohort together with the members in it: ids, resolved against the roster. */
export interface CohortWithMembers extends Cohort {
  memberIds: string[];
}

export interface CreateCohortPayload {
  name: string;
  description?: string;
  /** A date-only string or epoch ms. */
  startAt?: number | string;
  endAt?: number | string;
}

export interface UpdateCohortPayload {
  name?: string;
  description?: string;
  /** `null` clears the date rather than storing an empty one. */
  startAt?: number | string | null;
  endAt?: number | string | null;
}

export interface ListCohortsResponse {
  cohorts: CohortWithMembers[];
}

export interface CohortResponse {
  cohort: CohortWithMembers;
  /** Whether the call is what put the member in — absent on create and update. */
  added?: boolean;
  removed?: boolean;
}

/** What a reward is, which is also how it is handed over. */
export type RewardKind = 'COUPON' | 'GIFT_CARD' | 'CUSTOM';

export const REWARD_KINDS: RewardKind[] = ['COUPON', 'GIFT_CARD', 'CUSTOM'];

export const REWARD_KIND_LABELS: Record<RewardKind, string> = {
  COUPON: 'Coupon',
  GIFT_CARD: 'Gift card',
  CUSTOM: 'Custom',
};

export const REWARD_KIND_DESCRIPTIONS: Record<RewardKind, string> = {
  COUPON: 'A discount code, generated for each member who earns it.',
  GIFT_CARD: 'A code for a stated amount, generated for each member who earns it.',
  CUSTOM: 'Something handed over by hand — the reward says what to do.',
};

/** What a learner has to do to earn a reward. */
export type RewardMilestoneType = 'LESSONS_COMPLETED' | 'PERCENT_COMPLETE';

export const REWARD_MILESTONE_TYPES: RewardMilestoneType[] = [
  'LESSONS_COMPLETED',
  'PERCENT_COMPLETE',
];

export const REWARD_MILESTONE_LABELS: Record<RewardMilestoneType, string> = {
  LESSONS_COMPLETED: 'Lessons completed',
  PERCENT_COMPLETE: 'Course completed',
};

/** The unit a milestone's value is counted in, for a form and a list. */
export const REWARD_MILESTONE_UNITS: Record<RewardMilestoneType, string> = {
  LESSONS_COMPLETED: 'lessons',
  PERCENT_COMPLETE: '% of the course',
};

export interface RewardMilestone {
  type: RewardMilestoneType;
  value: number;
}

/** A reward a course offers for reaching a milestone. */
export interface SpaceReward {
  rewardId: string;
  spaceId: string;
  organizationId: string;
  name: string;
  description: string;
  kind: RewardKind;
  milestone: RewardMilestone;
  /** Face value in cents. Only meaningful on a gift card. */
  amountCents?: number;
  /** ISO-4217 code, e.g. `USD`. Only meaningful on a gift card. */
  currency?: string;
  /** Prefix generated codes carry. */
  codePrefix?: string;
  /** What to do to claim it, for a reward handed over by hand. */
  instructions?: string;
  /** How many may ever be granted. Absent means as many as are earned. */
  grantLimit?: number;
  active: boolean;
  grantCount: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type RewardGrantStatus = 'ISSUED' | 'REDEEMED' | 'REVOKED';

export const REWARD_GRANT_STATUS_LABELS: Record<RewardGrantStatus, string> = {
  ISSUED: 'Issued',
  REDEEMED: 'Redeemed',
  REVOKED: 'Revoked',
};

/** One reward, held by one member. */
export interface RewardGrant {
  rewardId: string;
  userId: string;
  spaceId: string;
  organizationId: string;
  /** The code the member redeems, on the kinds that carry one. */
  code?: string;
  status: RewardGrantStatus;
  /** An instructor's `sub`, or `SYSTEM` when a milestone issued it. */
  grantedBy: string;
  progress?: number;
  note?: string;
  grantedAt: number;
  redeemedAt?: number;
  updatedAt: number;
}

/** A reward and the grants made under it, as the rewards tab reads it. */
export interface RewardWithGrants extends SpaceReward {
  grants: RewardGrant[];
}

export interface CreateRewardPayload {
  name: string;
  description?: string;
  kind: RewardKind;
  milestone: RewardMilestone;
  amountCents?: number;
  currency?: string;
  codePrefix?: string;
  instructions?: string;
  grantLimit?: number;
  active?: boolean;
}

/** Every field optional: the form sends what changed and nothing else. */
export interface UpdateRewardPayload {
  name?: string;
  description?: string;
  milestone?: RewardMilestone;
  amountCents?: number | null;
  currency?: string | null;
  codePrefix?: string | null;
  instructions?: string | null;
  grantLimit?: number | null;
  active?: boolean;
}

export interface ListRewardsResponse {
  rewards: RewardWithGrants[];
}

export interface RewardResponse {
  reward: RewardWithGrants;
}

export interface GrantRewardPayload {
  /** One of these two addresses the member. */
  userId?: string;
  email?: string;
  code?: string;
  note?: string;
}

export interface RewardGrantResponse {
  grant: RewardGrant;
  /** Whether this call is what created the grant. */
  created: boolean;
  /** What happened to the email telling them about it, and why not when not. */
  delivery: MailDelivery;
  /** Where the reward is seen: the course's rewards in the marketplace. */
  rewardsUrl: string;
}

export interface RevokeRewardGrantResponse {
  /** Absent when an unused grant was removed rather than marked revoked. */
  grant: RewardGrant | null;
  removed: boolean;
}

/** A reward the signed-in learner holds, with what it is and where it came from. */
export interface MyReward extends RewardGrant {
  reward: SpaceReward;
  spaceTitle: string;
  orgId: string;
}

export interface ListMyRewardsResponse {
  rewards: MyReward[];
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
  /**
   * Rewards this lesson's completion earned, if any — the milestone check runs
   * in the same request, so the page can say what was won straight away.
   */
  earned?: RewardGrant[];
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

/**
 * What a favourite can be aimed at: a lesson, one comment on one, or a loop
 * somebody kept. The API writes `LOOP` rows too, so a list that only knows the
 * first two is a list that meets a third kind it cannot name.
 */
export type FavouriteTargetType = 'CONTENT' | 'COMMENT' | 'LOOP';

/** One learner's favourite, over a lesson, a comment, or a loop. */
export interface Favourite {
  userId: string;
  targetKey: string;
  targetType: FavouriteTargetType;
  targetId: string;
  /** The lesson the comment or loop hangs off, so it can be read back. */
  contentId?: string;
  /** Who owns a favourited loop: a loop is keyed by its owner as well as its id. */
  targetOwnerId?: string;
  createdAt: number;
}

/** A favourite together with what it points at, when that still exists. */
export interface FavouriteEntry extends Favourite {
  content?: Content;
  comment?: Comment;
  loop?: ContentLoop;
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

/**
 * The marketplace catalog, as the API serves it to anybody — signed in or not.
 *
 * A listed course is public: what it is called, who it is from, how much of it
 * there is, and what its sections hold. The lessons themselves are not, which
 * is why `CatalogLesson` says only whether a lesson has a video to play.
 */

/** The part of a course a card draws, in either app. */
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

export interface CatalogCourse extends CourseSummary {
  organizationId: string;
  organizationName: string;
  /** A signed URL for the course's cover, when it has one. */
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
  /**
   * Who teaches it, in the order they were put on the course.
   *
   * Not part of `CatalogCourse`, which the catalog's own listing draws: a page
   * of twenty courses does not name twenty teachers, and answering "who teaches
   * this" for each of them is a roster read and a profile read per card. Here it
   * is one question about one course, on the page that asks it.
   */
  instructors: PublicInstructor[];
}

/**
 * API keys — the way somebody outside these two apps calls the API.
 *
 * Everything else in this file describes a request one of our own screens makes
 * with a signed-in person's token behind it. A key is the other kind of caller:
 * a script, a partner's backend, a customer's pipeline, none of which can
 * complete a sign-in. It authenticates with one header and reaches a small,
 * read-only surface under `/v1`.
 */

/**
 * One key, as its owner sees it.
 *
 * The secret is deliberately absent, and not because this shape is trimmed for
 * display: the API keeps only a hash of the secret, so the full key exists once
 * — in the response that created it — and cannot be read back afterwards.
 *
 * There is no revoked state, because a revoked key is deleted: this shape only
 * ever describes a key that works.
 */
export interface ApiKey {
  /** ULID. Public: it identifies the key, and it is what revokes one. */
  keyId: string;
  /** What the key is for, as its owner named it. */
  name: string;
  /**
   * The beginning of the secret, e.g. `play_sk_9f2c1a`. Enough to tell two keys
   * apart in a list, and not enough to use one.
   */
  prefix: string;
  createdAt: number;
  /**
   * The last time the key was presented, written at most every few minutes so
   * that authenticating is not a write on every request.
   */
  lastUsedAt?: number;
  /**
   * The organization the key was made for, when its creator named one. It is
   * what an admin's list reads, and what decides whether the key can read that
   * organization's courses as well as the public catalog.
   */
  organizationId?: string;
  organizationName?: string;
}

/**
 * A key as an organization's admin sees it: the key, and who made it.
 *
 * Separate from `ApiKey` because the extra fields are why the shape exists —
 * an admin looking at a list of keys nobody can attribute cannot decide which
 * one to cut off.
 */
export interface OrganizationApiKey extends ApiKey {
  /** Cognito `sub` of the person who created the key. */
  userId: string;
  /** Their email at the time, when the API knows one. */
  userEmail?: string;
}

export interface CreateApiKeyPayload {
  /** What the key is for, e.g. `Nightly reporting`. 2–60 characters. */
  name: string;
  /**
   * The organization to make the key for, when the caller wants one. Any active
   * member may name the organization they are making it for; the key then
   * appears in that organization's list, where its admins can revoke it.
   */
  organizationId?: string;
}

/**
 * The one response that carries the secret.
 *
 * `secret` is the whole key and the only time it is ever transmitted: it is
 * shown once, and a caller that loses it makes another key.
 */
export interface CreateApiKeyResponse {
  key: ApiKey;
  secret: string;
}

export interface ListApiKeysResponse {
  keys: ApiKey[];
  /**
   * Present only when the caller holds more keys than one page. The page asks
   * for the API's ceiling rather than for twenty, and says so when even that is
   * not the whole list — a keys screen that quietly showed some of them would be
   * a screen you cannot audit your own access from.
   */
  nextToken?: string;
}

export interface ListOrganizationApiKeysResponse {
  keys: OrganizationApiKey[];
  nextToken?: string;
}

/**
 * The identity a presented key acts as, which is what `GET /v1/me` answers.
 *
 * The one call that says whether a key works at all, and the one worth making
 * from a new integration before anything else is wired up.
 */
export interface ApiKeyIdentityResponse {
  key: ApiKey;
  owner: {
    /** Cognito `sub` of the key's owner — the identity the key acts as. */
    userId: string;
  };
}

/**
 * A lesson, as the API hands it to somebody building the classroom somewhere
 * else: the pieces a page needs to teach with.
 *
 * Four shapes rather than one, because each is fetched at a different moment and
 * signed with its own expiry — the lesson and its notes are read once, the
 * manifest before playback, the subtitle tracks by the player, the attachments
 * when somebody opens them.
 */
export interface ApiLesson {
  contentId: string;
  /** The course it belongs to. */
  spaceId: string;
  sectionId: string;
  title: string;
  /**
   * The author's notes beside the video, as the document they wrote — a
   * ProseMirror tree, the same one the classroom renders. Deliberately not HTML:
   * this API does not sanitize markup for a caller, and a document a caller
   * renders with an editor of its choice is not a string anybody has to trust.
   */
  notes?: NotesDocument;
  /** The video it plays, when it has one. Reachable through `/stream`. */
  videoId?: string;
  /** Signed poster image URL for the video, when it has a thumbnail. */
  thumbnailUrl?: string;
  /** Attachments on the lesson. `/attachments` returns them with URLs. */
  fileCount: number;
  /** 1-based order inside its section. */
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface ApiLessonResponse {
  lesson: ApiLesson;
}

/** A course's outline: the same shape the public syllabus uses. */
export interface ApiSectionsResponse {
  sections: CatalogSection[];
}

/**
 * How to play a lesson's video.
 *
 * `manifestUrl` is a signed HLS manifest. `baseUrl` and `signedQuery` are beside
 * it because the signature covers the video's whole stream prefix rather than
 * one file, so the same query has to be attached to every segment the player
 * asks for — the one thing a caller cannot derive from the manifest alone.
 */
export interface ApiLessonStreamResponse {
  videoId: string;
  manifestUrl: string;
  baseUrl: string;
  signedQuery: string;
  /** Expiry in epoch seconds. Refetch this rather than holding a page open past it. */
  expiresAt: number;
}

/** One subtitle track: a signed WebVTT URL, and what it holds. */
export interface ApiSubtitleTrack {
  /** BCP-47 code, e.g. `en-US` or `zh-CN`. */
  language: string;
  /** Human-readable label, e.g. `English`. */
  label: string;
  isSource: boolean;
  subtitleUrl: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

export interface ApiLessonSubtitlesResponse {
  /** Null when the lesson has no video at all. */
  videoId: string | null;
  /**
   * Whether captions exist yet. A lesson whose subtitles are still being
   * generated answers with this and no tracks, rather than an error: a page
   * renders "no captions yet" as a state, not as a failure.
   */
  status: SubtitleStatus;
  /** The language it was transcribed in, when there are tracks. */
  sourceLanguage?: string;
  tracks: ApiSubtitleTrack[];
  /** Every word with when it is said, for a transcript that follows along. Capped. */
  words?: TranscriptWord[];
}

/** One file attached to a lesson, with a signed URL. */
export interface ApiLessonAttachment {
  fileId: string;
  name: string;
  contentType: string;
  size?: number;
  /** Signed URL. Good until `expiresAt`. */
  url?: string;
  createdAt: number;
}

export interface ApiLessonAttachmentsResponse {
  attachments: ApiLessonAttachment[];
  /** Expiry in epoch seconds, shared by every URL in the answer. */
  expiresAt: number;
}
