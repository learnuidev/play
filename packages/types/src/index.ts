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
  /**
   * What the course costs, in the smallest unit of `currency` — cents.
   *
   * **Absent means free**, which is the same as `0` on purpose: a course that has
   * never been priced and a course that costs nothing are both registrable
   * without a payment, and a UI that had to tell three states apart would
   * eventually charge somebody for a free course.
   */
  priceCents?: number;
  /** ISO 4217, lower case as Stripe spells it: `usd`. Absent means `usd`. */
  currency?: string;
  /**
   * The Stripe price object this course is sold at.
   *
   * **Written by the server**, not by an author: it is a cache of the price
   * Stripe holds for this course's amount, so the dashboard shows one line per
   * course rather than one per attempted purchase. Never send it — the amount
   * above is what a person sets.
   */
  stripePriceId?: string;
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
  /**
   * What the course costs, in the smallest unit of `currency`.
   *
   * `null` — or an empty string — makes it free again. A whole number of cents:
   * a price typed as a decimal and sent as a number is off by a hundred the
   * moment somebody forgets which end of it they are on, so the form does the
   * conversion and this field is always the small unit.
   */
  priceCents?: number | null;
  /** ISO 4217, lower case: `usd`. `null` falls back to `usd`. */
  currency?: string | null;
  /**
   * Deliberately absent: the Stripe price object is the server's to cache, and a
   * client choosing one would be picking a number from somewhere other than the
   * price on the course.
   */
}

/**
 * What asking to pay for a course answers with.
 *
 * A URL rather than a payment: this is a redirect to Stripe's own hosted page,
 * and nothing about the purchase is decided until the webhook hears the money
 * arrive. The id is the checkout session, which is also the id of the pending
 * payment row — the same string, so a support question about a URL and a row in
 * the table are the same lookup.
 */
export interface CheckoutSessionResponse {
  url: string;
  paymentId: string;
  amountCents: number;
  currency: string;
}

/** What the overview's four cards read. */
export interface SpaceStats {
  students: number;
  sections: number;
  contents: number;
  /** How many of `contents` are quizzes rather than lessons. */
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
  /**
   * When they **bought** it, if they did.
   *
   * The distinction that matters on a course page: a course with a price and a
   * learner who was invited into it freely are two different relationships, and
   * only the second one can be walked away from. It is the paid payment's own
   * `paidAt`, so the course page, the refund window and the receipt all read the
   * same moment rather than three approximations of it.
   */
  purchasedAt?: number;
}

export interface ListMyCoursesResponse {
  courses: MyCourse[];
}

/**
 * A card somebody has saved, as this product holds it.
 *
 * **Never the number.** The card itself lives in Stripe, entered on Stripe's own
 * page; what is stored here is the token that refers to it and the four facts
 * worth showing a person — which brand, which four digits, and when it expires.
 * Anything more would be this service holding a card, which is a thing it must
 * never do.
 */
export interface SavedPaymentMethod {
  /** Stripe's `pm_…` id, and the only handle anything ever acts through. */
  paymentMethodId: string;
  /** `visa`, `mastercard`, … as Stripe spells it, lower case. */
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  createdAt: number;
}

export interface ListPaymentMethodsResponse {
  paymentMethods: SavedPaymentMethod[];
}

/**
 * What a card form needs to open.
 *
 * The marketplace draws the card field itself with Stripe Elements, so this is
 * not a redirect to anywhere: it is the two values an Element cannot work
 * without — a **client secret** for a SetupIntent, and the **publishable key**
 * Stripe.js is loaded with — plus the intent's id, which is what the form quotes
 * back once Stripe says the card is on it.
 *
 * Both come from the deployment rather than from the app's environment, so a
 * deployment has one source for them: the console already shows the publishable
 * key on its Checklist, and a copy in `.env.local` would be a second one to keep
 * in step.
 */
export interface SetupIntentResponse {
  setupIntentId: string;
  /** `seti_…_secret_…`: what `stripe.confirmSetup` is given. */
  clientSecret: string;
  /** `pk_…`: what `loadStripe` is given. Not a secret — it is served to browsers. */
  publishableKey: string;
  /**
   * The billing country this account is set to, from the last card it saved.
   *
   * ISO 3166-1 alpha-2, upper case, as Stripe spells it. **Null is "they have not
   * said"** — a different answer from the deployment's own country, and the
   * reason the form starts empty rather than assuming one.
   */
  country: string | null;
}

/** Saving the card a form just confirmed. */
export interface SavePaymentMethodPayload {
  setupIntentId: string;
}

export interface SavePaymentMethodResponse {
  paymentMethod: SavedPaymentMethod;
}

/**
 * What became of one attempted purchase.
 *
 * The same five the payments table holds, and the same five a Stripe event can
 * move a row between: a checkout that nobody completed is `EXPIRED` rather than
 * nothing, because "they tried" is a different fact from "they never did".
 */
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED';

/**
 * How long a learner has to change their mind about a purchase, in days.
 *
 * Mirrors the constant the API enforces in `lib/payments` — the same way the
 * profile's length limits are declared here for the forms and held again on the
 * server — and it is here so that no screen has to write "30" into a sentence.
 * What a screen decides with is `BillingEntry.refundable` and `refundDeadline`,
 * which the API computes: this number is for the copy, not for the rule.
 */
export const REFUND_WINDOW_DAYS = 30;

/** One purchase, as the person who made it reads it. */
export interface BillingEntry {
  /** The Stripe checkout session id, and the row's own key. */
  paymentId: string;
  spaceId: string;
  /** The course as it is called now. Empty when the course is gone. */
  courseTitle: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  createdAt: number;
  paidAt?: number;
  refundedAt?: number;
  /**
   * Whether asking for a refund right now would be accepted.
   *
   * Decided by the API rather than by the screen, because the rule is a fact
   * about the payment and not about the page: the 30 days, the status, and
   * whether there is a Stripe payment behind it at all. A screen that computed
   * this itself would be a second answer to a question with one.
   */
  refundable: boolean;
  /** When the 30 days are up, for the payments that are still inside them. */
  refundDeadline?: number;
}

export interface BillingHistoryResponse {
  payments: BillingEntry[];
}

export interface RefundPaymentResponse {
  payment: BillingEntry;
}

/**
 * How far one learner has got in one course.
 *
 * The lesson they should open next is the first one in the course's own order
 * they have not finished, or the first lesson again once they have finished them
 * all. It is absent for a course with nothing published, which is the one case
 * with no lesson to open at all — a card that would otherwise offer a link to
 * nowhere can tell the two apart.
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
 * The ids travel only on the course's own read: an outline draws a tick per row
 * and needs to know which rows — while a list of courses needs the numbers and
 * nothing else, and a hundred lesson ids per course would be paid for on every
 * card.
 */
export interface SpaceProgressResponse extends CourseProgress {
  completedContentIds: string[];
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

/**
 * What a piece of content *is*.
 *
 * - `VIDEO` — a lesson: footage, and the notes that go with it.
 * - `QUIZ`  — a set of questions. It has no video, and what it holds is in the
 *   questions table rather than on the row, for the reason a lesson's
 *   attachments have a table of their own: editing one question is one item
 *   write that cannot race with an edit to the question beside it.
 */
export type ContentType = 'VIDEO' | 'QUIZ';

export const CONTENT_TYPES: ContentType[] = ['VIDEO', 'QUIZ'];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  VIDEO: 'Video',
  QUIZ: 'Quiz',
};

export const CONTENT_TYPE_DESCRIPTIONS: Record<ContentType, string> = {
  VIDEO: 'A lesson: a video, its notes and the material around it.',
  QUIZ: 'A set of questions, generated from a lesson or written by hand.',
};

/**
 * What a question asks, and therefore how it is answered.
 *
 * - `TRUE_FALSE`       — one statement, and whether it is true.
 * - `MULTIPLE_CHOICE`  — a prompt with two to six options and one right answer.
 */
export type QuestionType = 'TRUE_FALSE' | 'MULTIPLE_CHOICE';

export const QUESTION_TYPES: QuestionType[] = ['TRUE_FALSE', 'MULTIPLE_CHOICE'];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  TRUE_FALSE: 'True or false',
  MULTIPLE_CHOICE: 'Multiple choice',
};

/**
 * How hard a question is meant to be.
 *
 * A **target rather than a measurement**: nothing here scores a question, and
 * nothing counts what a class got right — an author says how hard they meant it
 * to be, the same way they say which option is right, and the level is a band of
 * *expected* correct rate that the question is written to. What it is for is
 * that "hard" means the same thing to two authors, and that a run asking a model
 * for questions can say what it wants in terms a model can act on.
 *
 * - `EASY`   — recall and recognition. The question points straight at it.
 * - `MEDIUM` — processing or synthesis, or two steps, with some context removed.
 * - `HARD`   — exact wording or a niche corner, with distractors that have to be
 *              judged rather than spotted.
 * - `EXPERT` — an elite or competition standard, answerable only with real depth
 *              in the subject.
 */
export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';

export const QUESTION_DIFFICULTIES: QuestionDifficulty[] = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];

/**
 * What a question is graded at when nobody chooses.
 *
 * `EASY` rather than the middle, and for the reason a generated set is safest at
 * the bottom of the scale: a question that turns out too easy is one the author
 * moves up a level, and one that turns out too hard is one their learners cannot
 * answer at all. The default is the mistake that costs a click.
 */
export const DEFAULT_QUESTION_DIFFICULTY: QuestionDifficulty = 'EASY';

export const QUESTION_DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
  EXPERT: 'Expert',
};

/**
 * The correct rate each level is written to, as a band.
 *
 * The whole reason the four levels are named rather than numbered: an author who
 * is told "easy" and nothing else has been told nothing they can check their
 * question against, and "aim for most learners to get this" is a sentence a
 * person — or a model writing one — can actually work to.
 */
export const QUESTION_DIFFICULTY_TARGETS: Record<QuestionDifficulty, string> = {
  EASY: '76–100% correct',
  MEDIUM: '40–75% correct',
  HARD: '11–39% correct',
  EXPERT: '10% or fewer correct',
};

/**
 * What each level asks of a learner — the other half of the band.
 *
 * Read by an author choosing one, and handed to the model when a run is asked for
 * a level, which is why it is written as a description of the question to write
 * rather than as a grade to hand out.
 */
export const QUESTION_DIFFICULTY_DESCRIPTIONS: Record<QuestionDifficulty, string> = {
  EASY: 'Literal recall, recognition or naming — the question gives maximum context and points at the answer.',
  MEDIUM: 'Processing or synthesis, or a two-step answer — some context is removed, so the options have to be narrowed down.',
  HARD: 'Exact timelines, nuanced wording or a specialised corner — plausible options that have to be judged rather than spotted.',
  EXPERT: 'An elite or competition standard — context heavily removed, answerable only with years in the subject.',
};

/**
 * How far a question has got towards being usable.
 *
 * A question written by a machine is a *draft*: an AI can write ten plausible
 * questions from a transcript and get one subtly wrong, and a question nobody
 * has read is one a learner could be marked against. So everything generated or
 * imported arrives as `NEEDS_VERIFICATION`, and only a person reading it and
 * saying "this is right" makes it `VERIFIED`. A question that is wrong is
 * deleted rather than marked — "rejected" and "not yet read" would both stop a
 * question being asked, and only one of them can be told apart by a reader.
 */
export type QuestionStatus = 'NEEDS_VERIFICATION' | 'VERIFIED';

export const QUESTION_STATUSES: QuestionStatus[] = ['NEEDS_VERIFICATION', 'VERIFIED'];

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  NEEDS_VERIFICATION: 'Needs verification',
  VERIFIED: 'Verified',
};

/** Where a question came from. A reader verifying one should know who wrote it. */
export type QuestionSource = 'AI' | 'IMPORT' | 'MANUAL';

export const QUESTION_SOURCE_LABELS: Record<QuestionSource, string> = {
  AI: 'Generated',
  IMPORT: 'Imported',
  MANUAL: 'Written',
};

/** One answer a learner may choose. `id` is what the answer is recorded against. */
export interface QuestionOption {
  /**
   * Short and stable: `a`…`f`, in the order the options were given.
   *
   * An answer is stored as an option id rather than an index because an index
   * is a position: reordering or removing an option would silently move every
   * stored answer to the question onto a different one.
   */
  id: string;
  text: string;
}

/**
 * A question bank: an organization's library of questions.
 *
 * A bank is where questions *live*. A quiz does not own questions — it asks
 * some of them — so one question written once can be asked by a quiz in this
 * course, a retake, and next term's version of the same course. That is the
 * whole reason banks exist: a question is worth writing carefully once, and
 * worth asking more than once.
 *
 * A bank belongs to the organization rather than to a course, because the
 * questions in it are about *lessons*, and which lesson a question is about is
 * on the question. A course-shaped bank would mean writing the same question
 * again the moment two courses share a lesson's subject.
 */
export interface QuestionBank {
  /** ULID, the table key. */
  bankId: string;
  /** The organization that owns it. A bank never exists outside one. */
  organizationId: string;
  /** Required, 2–80 characters (whitespace collapsed). */
  name: string;
  /** Optional, ≤ 500 characters. */
  description: string;
  /** How many questions it holds, kept on the row so a list needs no query each. */
  questionCount: number;
  /**
   * The last AI generation asked of this bank.
   *
   * On the bank rather than on a table of its own for the reason a quiz's run is
   * on its content row: there is one live run per bank at most — asking twice
   * replaces the first — and a job row nobody lists is a row that exists to be
   * deleted. The page that asked for it is the page that polls it.
   */
  generation?: QuizGeneration;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * One question, as the API stores and hands it out.
 *
 * Two things about it are the model's whole shape:
 *
 * - **It belongs to a bank**, which is where it is written, imported, generated,
 *   verified and deleted.
 * - **It is associated with a lesson** — required, not optional. A question
 *   without a lesson is a question nobody can tell is still true: the lesson
 *   moves, the words that made the question correct change, and the question
 *   goes on being asked. Naming the lesson is also what lets a quiz in a course
 *   pick the questions that are about *its* lessons and no others.
 */
export interface QuizQuestion {
  /** ULID, the table key. */
  questionId: string;
  /** The bank it lives in. */
  bankId: string;
  /** Denormalized from the bank, so a question authorizes in one hop. */
  organizationId: string;
  /** The lesson it is about — a `VIDEO` content. Required. */
  lessonContentId: string;
  /**
   * Denormalized from that lesson, so a quiz can be told which of its own
   * course's questions this is without a second read.
   */
  lessonSpaceId: string;
  type: QuestionType;
  /** The statement to judge, or the question to answer. */
  prompt: string;
  /** Two to six options. Always present: true/false is two fixed options. */
  options: QuestionOption[];
  /**
   * The option(s) that answer it. Exactly one today — a question with two right
   * answers is a different kind ("select all that apply"), and nothing asks for
   * one yet. The plural is deliberate: it is the shape a second kind would
   * need, so adding one is a change to validation rather than to storage.
   */
  correctOptionIds: string[];
  /** Why the answer is the answer. Shown to an author, not to a learner. */
  explanation?: string;
  status: QuestionStatus;
  source: QuestionSource;
  /**
   * How hard it is meant to be, when its author said.
   *
   * Optional because it is a judgement rather than a fact about the question: a
   * question written before this existed, or imported from a file with no
   * difficulty column, has none — and nothing reads one, so an absent level
   * breaks no screen. It is deliberately *not* required, for the reason a
   * question's lesson is: a lesson is enforced because a question without one
   * cannot be checked, and a question without a level is simply one nobody
   * graded.
   */
  difficulty?: QuestionDifficulty;
  /** 1-based order inside the bank. Sparse: gaps are legal. */
  position: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** Who read it and said it was right, and when. */
  verifiedBy?: string;
  verifiedAt?: number;
}

/**
 * One question as a learner is handed it, on a quiz they have not answered yet.
 *
 * Everything a `QuizQuestion` carries except the answer: `correctOptionIds` and
 * `explanation` are the answer key, and the route that serves a paper has no
 * field to put them in. That is deliberate rather than tidy — a handler that
 * forgot to strip them would be handing out the answers, and a shape that cannot
 * carry them cannot make that mistake.
 */
export interface QuizPaperQuestion {
  questionId: string;
  type: QuestionType;
  /** The statement to judge, or the question to answer. */
  prompt: string;
  /** Two to six options, in the order the author gave them. */
  options: QuestionOption[];
}

/**
 * One answer a learner gave, and what it turned out to be.
 *
 * The question is copied in rather than looked up: an attempt is a record of
 * what somebody was asked and what they said, so a question edited since must
 * not reword the thing they got wrong, and one deleted since must not leave a
 * blank. `correctOptionIds` and `explanation` are what was true at the moment
 * they handed it in, for the same reason — an author fixing a mistake in a
 * question does not re-mark the attempts made against the old one.
 *
 * `optionId` absent is a question they skipped, which is wrong rather than
 * missing: the score is over the questions the quiz asks, so a blank is one
 * nobody got.
 */
export interface QuizAttemptAnswer {
  questionId: string;
  /** The question as it was asked. */
  prompt: string;
  /** The options it offered, in the order they were shown. */
  options: QuestionOption[];
  /** The option they chose. Absent when they skipped it. */
  optionId?: string;
  correctOptionIds: string[];
  correct: boolean;
  explanation?: string;
}

/** One sitting of a quiz: what was asked, what they said, and what it scored. */
export interface QuizAttempt {
  attemptId: string;
  contentId: string;
  spaceId: string;
  questionCount: number;
  correctCount: number;
  /** 0–100, rounded. */
  score: number;
  /** One entry per question asked, in the order the quiz asks them. */
  answers: QuizAttemptAnswer[];
  submittedAt: number;
}

/** A sitting as a list reads it: the numbers, and none of the answers. */
export interface QuizAttemptSummary {
  attemptId: string;
  questionCount: number;
  correctCount: number;
  score: number;
  submittedAt: number;
}

/**
 * A quiz as the learner taking it sees it.
 *
 * `heldBack` is the questions the quiz asks that nobody has verified yet: they
 * are answers no learner is marked against, and counting them here is what lets
 * a page explain a short quiz instead of looking broken. `attempts` is the
 * caller's own sittings, newest first, capped at the most recent twenty — and
 * `lastAttempt` is the newest of them in full, which is the result the page
 * opens on.
 */
export interface QuizPaperResponse {
  questions: QuizPaperQuestion[];
  heldBack: number;
  attempts: QuizAttemptSummary[];
  lastAttempt?: QuizAttempt;
}

/**
 * One answer, checked on its own rather than handed in with the rest.
 *
 * The paper is handed in once, at the end, and that is what records an attempt;
 * a check is a look at one question while it is still on the card, and it
 * records nothing. See `QuizCheckResponse`.
 */
export interface CheckQuizAnswerPayload {
  questionId: string;
  optionId: string;
}

/**
 * What checking one answer answers with.
 *
 * The right option's id and the explanation, which are the parts of the key a
 * learner is entitled to the moment they have answered — and the reason checking
 * happens on the server: a page that could say "correct" on its own would have
 * to have been given the key first.
 */
export interface QuizCheckResponse {
  questionId: string;
  optionId: string;
  correct: boolean;
  correctOptionIds: string[];
  explanation?: string;
}

/** One answer on a sheet being handed in. */
export interface QuizAttemptSubmission {
  questionId: string;
  /** The option chosen, or `null` for a question left blank. */
  optionId?: string | null;
}

export interface SubmitQuizAttemptPayload {
  /** A question left out of the list is one they skipped. */
  answers: QuizAttemptSubmission[];
  /**
   * The order each question's options were shown in, by question id.
   *
   * The options are dealt afresh on every sitting — the answer should not be
   * where the author wrote it — and the page is the only party that saw the hand
   * it was dealt. Sending it back is what lets the recorded attempt read in the
   * order it was sat; leave it out and the attempt falls back to the author's
   * order, which is a worse record and no less correct.
   */
  order?: Record<string, string[]>;
}

/**
 * What handing in a quiz answers with.
 *
 * Submitting finishes the quiz — answering is the learner's own "I have had my
 * go", so the completion and the course's rewards are written by the same
 * request, exactly as marking a lesson complete is. A score is not a threshold:
 * a quiz is taken, not passed, and an attempt that scored nothing still finished
 * it.
 */
export interface QuizAttemptResponse {
  attempt: QuizAttempt;
  completed: boolean;
  completedAt: number;
  /** Rewards this finished, if any. See `RewardGrant`. */
  earned: RewardGrant[];
}

/**
 * One question a quiz asks, and where it sits in it.
 *
 * A row of its own rather than a list on the quiz, because the two halves have
 * different owners: the question belongs to a bank and outlives the quiz, and
 * the quiz owns only the fact that it asks it and in what order. Removing a
 * question from a quiz deletes this row and leaves the question alone — which is
 * what makes a bank worth having.
 */
export interface QuizQuestionLink {
  /** The quiz content. */
  contentId: string;
  /** The question it asks. */
  questionId: string;
  /** 1-based order inside the quiz. Sparse: gaps are legal. */
  position: number;
  addedBy: string;
  addedAt: number;
}

/**
 * A generation the API was asked for, and how far it has got.
 *
 * AI generation does not fit in one request: API Gateway answers a REST request
 * in 29 seconds at the very most, and a model writing ten questions from a
 * lesson transcript routinely takes longer. So the request *starts* a job and
 * answers at once, a worker does the work, and the page reads this to find out
 * how it went — the same shape a video's `status` has while it is transcoding.
 *
 * It lives on the quiz's content row rather than in a table of its own: there is
 * one live generation per quiz at most (asking twice replaces the first), and a
 * job row nobody lists is a row that exists to be deleted.
 */
export type QuizGenerationStatus = 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';

export interface QuizGeneration {
  status: QuizGenerationStatus;
  /** The bank the questions are being written into. */
  bankId: string;
  /** The lesson they are being written from — which is also what they are about. */
  lessonContentId: string;
  /** How many were asked for, and which kinds. */
  count: number;
  types: QuestionType[];
  /**
   * How hard the run was asked to write them, which is also what every question
   * it wrote was stamped with.
   *
   * Optional because a run recorded before difficulty existed carries none — and
   * the page reads this record, so a missing field has to be a level nobody
   * asked for rather than a crash.
   */
  difficulty?: QuestionDifficulty;
  /**
   * The quiz to add them to once they are written, when a run was started from
   * a quiz. Absent for a run started in the bank, which is the ordinary case.
   */
  addToContentId?: string;
  /** Cognito `sub` of whoever asked. */
  requestedBy: string;
  requestedAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** How many questions the run actually wrote. Set on `READY`. */
  created?: number;
  /** Why it failed, in words a person reading the page can act on. */
  error?: string;
  /** The Bedrock model that wrote them, for `READY` runs. */
  model?: string;
}

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

/** One piece of content in a section: a lesson, or a quiz. */
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
  /**
   * The state of the last AI generation run against this content, when it is a
   * quiz. Absent until somebody asks for one.
   */
  generation?: QuizGeneration;
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

/**
 * Where a lesson or quiz now sits: which section, and where in it.
 *
 * Dragging a row in the outline is one request rather than one per row moved,
 * because the order is the *section's* — dropping something in the middle of
 * forty lessons renumbers what follows it, and a client cannot be trusted to
 * write that correctly or to write it once.
 */
export interface PlaceContentPayload {
  /** The section it lands in. Omit to reorder within the section it is in. */
  sectionId?: string;
  /** Zero-based index inside that section's content, counting from the top. */
  index: number;
}

/**
 * A question as it is written or edited.
 *
 * The same shape is what an import produces, which is why `options` is a list of
 * texts here rather than of `QuestionOption`: on the way *in* an option's id is
 * its position, and the API assigns the ids.
 */
export interface QuestionInput {
  type: QuestionType;
  prompt: string;
  /** Two to six option texts. Omitted for a true/false question, which has two. */
  options?: string[];
  /**
   * Which option answers it: a zero-based index, or the option's own text.
   *
   * An index because that is what a spreadsheet column holds, and the text
   * because that is what a person writes in one — a row whose answer column
   * says "1789" should work whether 1789 is the third option or the whole of it.
   */
  answer?: number | string | boolean;
  explanation?: string;
  /**
   * How hard the question is meant to be. Optional: an import without a
   * difficulty column, and an author who left it alone, both send nothing.
   */
  difficulty?: QuestionDifficulty;
}

/**
 * Writing a question into a bank.
 *
 * `lessonContentId` is required here rather than on `QuestionInput`, because it
 * is a fact about the *call* rather than about the question's words: a bank's
 * questions are grouped by the lesson they are about, and an import or a
 * generation writes a whole file's worth for one lesson in one go.
 */
export interface CreateQuestionPayload extends QuestionInput {
  /** The lesson the question is about — a `VIDEO` content of this organization. */
  lessonContentId: string;
}

/** One question as an import read it: the input, or the row that failed. */
export interface ImportedQuestionRow {
  /** 1-based row number in the file, so an error can be pointed at. */
  row: number;
  question?: QuestionInput;
  error?: string;
}

export interface ImportQuestionsPayload {
  /** `questions.xlsx`, `questions.csv` or `questions.json` — the extension decides. */
  fileName: string;
  /** The file itself, base64. */
  contentBase64: string;
  /** The lesson every question in the file is about. Required. */
  lessonContentId: string;
}

export interface ImportQuestionsResponse {
  /** The questions that were written. */
  imported: QuizQuestion[];
  /** The rows that were not, and why. */
  skipped: ImportedQuestionRow[];
  /** How many rows the file held, read and rejected together. */
  rows: number;
}

export interface UpdateQuestionPayload {
  type?: QuestionType;
  prompt?: string;
  options?: string[];
  answer?: number | string | boolean;
  /** `null` clears the explanation. */
  explanation?: string | null;
  /** Point the question at a different lesson. */
  lessonContentId?: string;
  /**
   * Re-grade it, or `null` to leave it ungraded.
   *
   * Unlike the prompt, the options and the lesson, changing this does **not**
   * take the verification away: it says how hard the question is, not what it
   * asks, and a person who read the question read the same question either way.
   */
  difficulty?: QuestionDifficulty | null;
}

/**
 * What asking for AI generation answers with.
 *
 * Not the questions: the run has only just been queued, and it lands on the
 * *bank's* row, which is what the page polls. The bank carries it rather than
 * the quiz because a run writes questions into the bank — a quiz that asked for
 * one may be gone by the time the questions arrive, and the questions are not.
 */
export interface GenerateQuestionsPayload {
  /** The lesson to write questions from — which is also what they are about. */
  lessonContentId: string;
  /** How many to write, 1–20. */
  count?: number;
  /** Which kinds to write. Defaults to both. */
  types?: QuestionType[];
  /**
   * How hard to write them. Defaults to `EASY`.
   *
   * One level for a whole run rather than one per question, because the level is
   * what the instruction to the model *is*: a run asked for a mix is a run asking
   * for four different things at once, which is what asking twice is for. Every
   * question the run writes carries this level, whatever the model says about it.
   */
  difficulty?: QuestionDifficulty;
  /** A quiz to add them to once they are written. Same course as the lesson. */
  addToContentId?: string;
}

/** A bank's questions, or a quiz's, in the order they are asked. */
export interface ListQuestionsResponse {
  questions: QuizQuestion[];
  /** How many are still waiting for somebody to read them. */
  needsVerification: number;
}

export interface QuestionResponse {
  question: QuizQuestion;
}

/** A list of questions, as the routes that move them answer. */
export interface QuestionsResponse {
  questions: QuizQuestion[];
}

/** What adding questions to a quiz did. */
export interface AddQuizQuestionsResponse {
  /** How many this call added. */
  added: number;
  /** How many were already asked by this quiz, and so left alone. */
  alreadyAsked: number;
  questions: QuizQuestion[];
}

/**
 * Where a question now sits in the quiz that asks it.
 *
 * The quiz is the path and the question is in the body, because a quiz's order
 * belongs to the quiz: dropping a row third from the top renumbers what follows
 * it, and the server works that out from what the quiz currently asks.
 */
export interface PlaceQuizQuestionPayload {
  questionId: string;
  /** Zero-based index inside the quiz, counting from the top. */
  index: number;
}

/** What a batch verification did, and what the list looks like now. */
export interface BatchVerificationResponse {
  /** How many this call verified. */
  verified: number;
  questions: QuizQuestion[];
}

export interface CreateQuestionBankPayload {
  name: string;
  description?: string;
}

export interface UpdateQuestionBankPayload {
  name?: string;
  description?: string;
}

export interface ListQuestionBanksResponse {
  banks: QuestionBank[];
}

export interface QuestionBankResponse {
  bank: QuestionBank;
}

export interface ListBankQuestionsResponse extends ListQuestionsResponse {
  /** The bank the questions are in, so a page needs one request to draw itself. */
  bank: QuestionBank;
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
  /**
   * What the course costs, in the smallest unit of `currency`. Absent or zero
   * means free.
   *
   * Carried on the summary because the two places a price is drawn are lists —
   * a catalog card and a course page's own header — and neither should have to
   * fetch the full course to know whether to say "Free".
   */
  priceCents?: number;
  /** ISO 4217, lower case as Stripe spells it: `usd`. Absent means `usd`. */
  currency?: string;
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
  /** `'QUIZ'` on a quiz. Absent on a lesson, which is what most rows are. */
  type?: ContentType;
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
 * The identity a presented credential acts as, which is what `GET /v1/me`
 * answers.
 *
 * The one call that says whether a credential works at all, and the one worth
 * making from a new integration before anything else is wired up. It answers for
 * both kinds — an API key and an OAuth access token — which is why `kind` is
 * here: a caller checking its own credentials wants to know which one it is
 * holding, and the two shapes beside it are deliberately different rather than a
 * lowest common denominator.
 *
 * Needs no scope: "is this working, and as whom" is exactly the question a
 * credential that has run out of permission still has to be able to ask.
 */
export interface ApiIdentityResponse {
  kind: 'key' | 'oauth';
  /** Present on a key. Absent on an OAuth access token. */
  key?: ApiKey;
  /** Present on an OAuth access token. Absent on a key. */
  oauth?: {
    app: OAuthAppSummary;
    scopes: ApiScope[];
    /** The same scopes as OAuth writes them: space-delimited. */
    scope: string;
  };
  owner: {
    /** Cognito `sub` of the person the credential acts as. */
    userId: string;
  };
  /** Every scope the credential holds. The half both kinds agree on. */
  scopes: ApiScope[];
}

/**
 * What `GET /v1/me/profile` answers: the person behind the credential.
 *
 * The *public* half of a profile — the same shape a marketplace course page
 * credits an instructor with — because that is the half this service is willing
 * to show anybody, and a consent screen cannot ask somebody to agree to
 * something they have never been able to see.
 */
export interface ApiProfileResponse {
  profile: PublicInstructor;
}

/* --------------------------------------------------------------------- OAuth */

/**
 * A scope: one thing an app may do on somebody's behalf.
 *
 * The whole vocabulary, and it is short on purpose. A scope is a sentence on a
 * consent screen, so the number of them is bounded by how many a person can read
 * and tell apart rather than by how many endpoints this API has. The same list
 * lives in `services/api/src/lib/oauth-scopes`, and the API is the authority on
 * it — this copy exists so both apps and every screen can name a scope without
 * asking the server what they are called.
 */
export type ApiScope =
  /** The person: their name, their face, what they say about themselves, their links. */
  | 'profile:read'
  /** The published catalog, and any course that has been listed. */
  | 'courses:read'
  /** A course's outline, one lesson, and the files attached to it. */
  | 'lessons:read'
  /** A lesson's video and subtitles, as signed URLs. Costs bandwidth: its own scope. */
  | 'lessons:stream'
  /** One organization's courses, published or not. The only scope that is not public. */
  | 'organization:courses:read'
  /** What the person has finished and saved. Their own record, and nobody else's. */
  | 'learning:read'
  /** Marking a lesson complete, and saving one. Changes the person's own record. */
  | 'learning:write'
  /** Posting a comment on a lesson, as the person. The one that speaks for somebody. */
  | 'comments:write';

/** Every scope, in the order a consent screen shows them. */
export const API_SCOPES: ApiScope[] = [
  'profile:read',
  'courses:read',
  'lessons:read',
  'lessons:stream',
  'organization:courses:read',
  'learning:read',
  'learning:write',
  'comments:write',
];

/** What a newly registered app starts with, and the set its owner may narrow. */
export const DEFAULT_OAUTH_SCOPES: ApiScope[] = ['profile:read', 'courses:read', 'lessons:read'];

/**
 * An OAuth app, as the person who registered it sees it.
 *
 * The client id is public by definition — it travels in an authorization URL a
 * browser can read — and the secret is not on this shape at all: the API keeps a
 * hash, so the full secret exists once, in the response that created it (or the
 * one that rotated it), and nothing can read one back.
 */
export interface OAuthApp {
  /** ULID. What addresses the app in the studio's own URLs. */
  appId: string;
  /** The public half of the credential, e.g. `play_app_9f2c1a…`. */
  clientId: string;
  name: string;
  /** The sentence under the name on the consent screen. */
  description: string;
  homepageUrl?: string;
  logoUrl?: string;
  /** Where the app is allowed to be sent back to. Matched exactly. */
  redirectUris: string[];
  /** The most this app may ever ask a person for. */
  scopes: ApiScope[];
  /**
   * A public client: one that cannot keep a secret, so it has none. It
   * authenticates with its client id and PKCE, which every client uses anyway.
   */
  isPublic: boolean;
  /** The opening characters of the secret, for a list. Absent on a public client. */
  clientSecretPrefix?: string;
  createdAt: number;
  updatedAt: number;
}

/** An app as somebody who is not its owner sees it: what a consent screen draws. */
export interface OAuthAppSummary {
  appId: string;
  clientId: string;
  name: string;
  description: string;
  homepageUrl?: string;
  logoUrl?: string;
}

export interface CreateOAuthAppPayload {
  /** 2–60 characters. Shown on the consent screen. */
  name: string;
  /** Required: a consent screen that names an app and explains nothing is not consent. */
  description: string;
  homepageUrl?: string;
  logoUrl?: string;
  /** One or more absolute URIs. `http` only on localhost. */
  redirectUris: string[];
  /** A subset of the catalogue. At least one. */
  scopes: ApiScope[];
  /** True for a browser, desktop or CLI app: no secret is minted. */
  isPublic?: boolean;
}

/**
 * The one response that carries a client secret.
 *
 * `secret` is the whole secret and the only time it is ever transmitted. Absent
 * when the app is a public client, which has none by design.
 */
export interface CreateOAuthAppResponse {
  app: OAuthApp;
  secret?: string;
}

export interface ListOAuthAppsResponse {
  apps: OAuthApp[];
}

export interface OAuthAppResponse {
  app: OAuthApp;
}

export interface RotateClientSecretResponse {
  app: OAuthApp;
  secret: string;
}

export interface UpdateOAuthAppPayload {
  name?: string;
  description?: string;
  /** `null` clears it; absent leaves it alone. */
  homepageUrl?: string | null;
  logoUrl?: string | null;
  redirectUris?: string[];
  /**
   * Changing this **ends every authorization of the app**: the people who
   * connected it have to be asked again, with the new list on the screen.
   */
  scopes?: ApiScope[];
}

export interface UpdateOAuthAppResponse extends OAuthAppResponse {
  /** How many authorizations the scope change ended. Present only when it changed. */
  authorizationsEnded?: number;
}

/**
 * One app a person has authorized — what the connections screen lists.
 *
 * The app's name, description and mark are read live rather than stored with the
 * grant: an app can rename itself at any moment, and somebody deciding whether to
 * keep a connection needs to see what the app *is*, not what it was called on
 * the day they authorized it.
 */
export interface OAuthConnection {
  appId: string;
  clientId: string;
  name: string;
  description: string;
  homepageUrl?: string;
  logoUrl?: string;
  /** What this person agreed to. */
  scopes: ApiScope[];
  /** When they first connected it. */
  createdAt: number;
  /** When they last agreed to it, which is also when its scopes last changed. */
  updatedAt: number;
  /** The last time the app used it, accurate to about five minutes. */
  lastUsedAt?: number;
}

export interface ListOAuthConnectionsResponse {
  connections: OAuthConnection[];
}

/**
 * The parameters of an authorization request, as they appear in a consent URL.
 *
 * The RFC 6749 names, because a third party's OAuth library is what builds this
 * URL: the studio's consent page reads exactly the query string a client sent,
 * and hands the same values back. `code_challenge` and its method are required —
 * S256 only — because this service requires PKCE of every client, public or not.
 */
export interface OAuthAuthorizationParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope?: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
}

/** One scope an app asked for, and whether the person has already agreed to it. */
export interface OAuthScopeGrant {
  scope: ApiScope;
  granted: boolean;
}

/**
 * What the consent screen's one read answers.
 *
 * A union rather than one shape plus a status code, because a refused
 * authorization request has two possible fates and they are not interchangeable:
 * `ok: false` is a request that may still be reported to the *app*, by sending
 * the browser to `redirectUri` with `error=` in the query string — and it is the
 * one place this API hands a caller a URL to navigate to, which is why the URI
 * on it has been validated. Anything else is a 400 the screen renders, because
 * an unverified URI must never be redirected to.
 */
export type OAuthAuthorizationRequestResponse =
  | {
      ok: true;
      app: OAuthAppSummary;
      scopes: OAuthScopeGrant[];
      redirectUri: string;
      state?: string;
      /** True when this person has already agreed to all of it. */
      alreadyAuthorized: boolean;
    }
  | {
      ok: false;
      /** RFC 6749 §4.1.2.1 error code, e.g. `invalid_scope`. */
      oauthError: string;
      message: string;
      redirectUri: string;
      state?: string;
    };

/**
 * What "Allow" answers: everything the studio needs to complete the redirect,
 * and nothing it could get wrong.
 *
 * `redirectUri` comes from the API rather than from the query string the page
 * was opened with. That is the whole point of returning it — the page builds its
 * redirect from this field, so an attacker-supplied `redirect_uri` in the URL
 * can never be the destination.
 */
export interface ApproveAuthorizationResponse {
  code: string;
  redirectUri: string;
  state?: string;
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

/**
 * A comment, as `/v1` hands it out.
 *
 * Deliberately not `ApiComment`, which is the shape Play's own apps read: that
 * one carries whether the **caller** has hearted the comment, and a heart is part
 * of somebody's learning record — the thing `learning:read` is for — rather than
 * of the discussion. A route that hands out a discussion should not hand out a
 * person's hearts with it, and a field that always said `false` would be worse
 * than one that is absent.
 */
export interface ApiLessonComment {
  commentId: string;
  contentId: string;
  /** Cognito `sub` of whoever wrote it — how a client recognises its own. */
  authorId: string;
  /** What they were called when they wrote it, read from their profile. */
  authorName: string;
  body: string;
  /** The thread's root, on a reply. Absent on a top-level comment. */
  parentId?: string;
  /** The comment this one answers, when that is not the thread's root. */
  replyToId?: string;
  /** How many replies the thread has, on a top-level comment. */
  replyCount: number;
  favouriteCount: number;
  createdAt: number;
  updatedAt: number;
}

/** A top-level comment and its replies, in the order they were written. */
export interface ApiLessonThread {
  comment: ApiLessonComment;
  replies: ApiLessonComment[];
}

/**
 * A lesson's discussion, as `/v1` hands it out.
 *
 * Threads rather than a flat list, because the two-level rule — a reply always
 * carries the thread's root, however deep the conversation looks — is the
 * server's invariant, and handing a client rows to nest itself invites it to get
 * that wrong. Same shape as Play's own discussion endpoint, minus the per-caller
 * hearts.
 */
export interface ApiLessonCommentsResponse {
  threads: ApiLessonThread[];
  /**
   * True when the discussion is longer than what was read, so a client can say
   * "showing the most recent N" rather than quietly showing half a conversation.
   */
  truncated: boolean;
}

/**
 * The comment a `POST` just created.
 *
 * The same shape the listing hands out, so a client that appends it to its own
 * thread list does not need a second definition of what a comment is.
 */
export interface ApiLessonCommentResponse {
  comment: ApiLessonComment;
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
