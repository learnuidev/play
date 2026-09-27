import { getContent, listSpaceIdsUsingVideo } from './contents';
import { getComment } from './comments';
import { getCohort } from './cohorts';
import { getVideo } from './dynamodb';
import { HttpError } from './http';
import { getMembership } from './organizations';
import { getReward } from './rewards';
import { getSection } from './sections';
import { isSpaceMember } from './space-members';
import { getSpace } from './spaces';
import type {
  Cohort,
  Comment,
  Content,
  OrgMember,
  OrgRole,
  Section,
  Space,
  SpaceReward,
  Video,
} from '../types';

/** Roles that may create, change, or delete what an organization owns. */
const WRITE_ROLES: OrgRole[] = ['ADMIN', 'EDITOR'];

export type AccessAction = 'read' | 'write';

/**
 * Authorizes a caller against an organization and returns their role.
 *
 * - `read`  — any active member.
 * - `write` — admins and editors only; viewers are read-only.
 *
 * A missing organization and a non-membership answer the same way (403) on
 * purpose: it keeps the API from revealing which organization ids exist.
 */
export async function requireOrganizationAccess(
  userId: string,
  organizationId: string,
  action: AccessAction,
): Promise<OrgRole> {
  const membership = await getMembership(organizationId, userId);
  // An invitation that has not been accepted is not access.
  if (!membership || membership.status !== 'ACTIVE') {
    throw new HttpError(403, 'Forbidden');
  }
  if (action === 'write' && !WRITE_ROLES.includes(membership.role)) {
    throw new HttpError(403, `A ${membership.role.toLowerCase()} cannot modify this organization`);
  }
  return membership.role;
}

/**
 * Authorizes a caller as an organization's admin and returns the membership.
 *
 * Admin is the narrowest of the three roles and the only one that may change
 * the roster, so it is checked here rather than through the read/write split:
 * an editor writes courses, they do not decide who is in the organization. The
 * membership row comes back because every caller of this also needs something
 * off it — who the caller is, or whether the row is an invitation.
 */
export async function requireOrganizationAdmin(
  userId: string,
  organizationId: string,
): Promise<OrgMember> {
  const membership = await getMembership(organizationId, userId);
  if (!membership || membership.status !== 'ACTIVE') {
    throw new HttpError(403, 'Forbidden');
  }
  if (membership.role !== 'ADMIN') {
    throw new HttpError(403, 'Only an admin can manage this organization’s members');
  }
  return membership;
}

/**
 * Loads a video and authorizes the caller against it.
 *
 * A video belongs to the organization it was uploaded to: every member of that
 * organization can read it, its admins and editors can change it. Its uploader
 * keeps access either way — which is also what keeps a video created before
 * organizations existed (one with no `organizationId`) reachable by its owner,
 * and what stops the organization backfill from locking anyone out of their own
 * uploads.
 *
 * Reading is wider than writing, and deliberately: a video is also *watched* in
 * the lessons that teach with it, and the people taking those lessons belong to
 * a course rather than to the organization behind it (see `assertVideoRead`).
 */
export async function requireVideoAccess(
  videoId: string,
  userId: string,
  action: AccessAction,
): Promise<Video> {
  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');

  if (video.ownerId === userId) return video;

  if (action === 'read') {
    await assertVideoRead(video, userId);
    return video;
  }

  if (video.organizationId) {
    await requireOrganizationAccess(userId, video.organizationId, action);
    return video;
  }

  throw new HttpError(403, 'Forbidden');
}

/**
 * Whether the caller may watch this video.
 *
 * Two ways in, and the second is what the marketplace added: a member of the
 * organization that owns the video, or a member of a *course* whose lessons play
 * it. A learner registers for a course, not for the organization that wrote it —
 * they may never have heard of that organization — so authorizing their playback
 * against the organization refuses the one thing the course is for.
 *
 * Membership of the course is checked rather than of the organization, and only
 * for courses that actually use this video: a learner in one course has no claim
 * on the video library of the organization behind it.
 */
async function assertVideoRead(video: Video, userId: string): Promise<void> {
  if (video.organizationId) {
    const membership = await getMembership(video.organizationId, userId);
    if (membership?.status === 'ACTIVE') return;
  }

  for (const spaceId of await listSpaceIdsUsingVideo(video.videoId)) {
    if (await isSpaceMember(spaceId, userId)) return;
  }

  throw new HttpError(403, 'Forbidden');
}

/**
 * Loads a space and authorizes the caller against the organization that owns it.
 *
 * Unlike a video, a space has no personal-owner escape hatch: it is always
 * organization property, so writing is exactly membership of that organization.
 *
 * Reading is deliberately wider. A course is the one thing in this API that can
 * be offered to somebody who has no business in the organization around it — a
 * guest instructor, a customer taking one course — and a course membership that
 * granted nothing would be an invitation to a locked room. So a `read` is
 * allowed for an active member of the organization *or* an active member of the
 * course itself; a `write` is the organization's, and a course member who is not
 * in the organization is a reader.
 */
export async function requireSpaceAccess(
  spaceId: string,
  userId: string,
  action: AccessAction,
): Promise<Space> {
  const space = await getSpace(spaceId);
  if (!space) throw new HttpError(404, 'Space not found');

  if (action === 'read') {
    await assertSpaceRead(space.spaceId, space.organizationId, userId);
    return space;
  }

  await requireOrganizationAccess(userId, space.organizationId, 'write');
  return space;
}

/**
 * Whether the caller may read what a course holds.
 *
 * Split out because a section and a piece of content are read through their own
 * ids and carry only the space they belong to; both paths want this same
 * question answered, and answering it in one place is what keeps a course's
 * members and its organization's members from drifting apart in what they see.
 */
async function assertSpaceRead(
  spaceId: string,
  organizationId: string,
  userId: string,
): Promise<void> {
  const membership = await getMembership(organizationId, userId);
  if (membership?.status === 'ACTIVE') return;

  if (await isSpaceMember(spaceId, userId)) return;

  // A missing organization and a non-membership answer the same way (403) on
  // purpose: it keeps the API from revealing which organization ids exist.
  throw new HttpError(403, 'Forbidden');
}

/**
 * Loads a section and authorizes the caller against the organization that owns
 * the space it belongs to.
 *
 * The section carries its organization, so this is a read plus the membership
 * check — no walk space-ward. A section cannot be moved to another space, so
 * the copy cannot fall out of step with its parent.
 */
export async function requireSectionAccess(
  sectionId: string,
  userId: string,
  action: AccessAction,
): Promise<Section> {
  const section = await getSection(sectionId);
  if (!section) throw new HttpError(404, 'Section not found');

  if (action === 'read') {
    await assertSpaceRead(section.spaceId, section.organizationId, userId);
    return section;
  }

  await requireOrganizationAccess(userId, section.organizationId, 'write');
  return section;
}

/**
 * Loads a piece of content and authorizes the caller against the organization
 * that owns it. Content carries both its section and its organization, so this
 * is likewise a read plus the membership check.
 */
export async function requireContentAccess(
  contentId: string,
  userId: string,
  action: AccessAction,
): Promise<Content> {
  const content = await getContent(contentId);
  if (!content) throw new HttpError(404, 'Content not found');

  if (action === 'read') {
    await assertSpaceRead(content.spaceId, content.organizationId, userId);
    return content;
  }

  await requireOrganizationAccess(userId, content.organizationId, 'write');
  return content;
}

/**
 * Loads a cohort and authorizes the caller against the course it groups.
 *
 * A cohort carries its space and its organization, so this is the course's own
 * access rule rather than a second one: whoever may read the course may see who
 * is in each of its groups, and whoever may change it may move people between
 * them.
 */
export async function requireCohortAccess(
  cohortId: string,
  userId: string,
  action: AccessAction,
): Promise<Cohort> {
  const cohort = await getCohort(cohortId);
  if (!cohort) throw new HttpError(404, 'Cohort not found');

  await requireSpaceAccess(cohort.spaceId, userId, action);
  return cohort;
}

/** Loads a reward and authorizes the caller against the course offering it. */
export async function requireRewardAccess(
  rewardId: string,
  userId: string,
  action: AccessAction,
): Promise<SpaceReward> {
  const reward = await getReward(rewardId);
  if (!reward) throw new HttpError(404, 'Reward not found');

  await requireSpaceAccess(reward.spaceId, userId, action);
  return reward;
}

/**
 * Loads a comment and authorizes the caller against the organization that owns
 * the content it is on. Comments are addressed by both ids, because the pair is
 * what the table is keyed by — there is no index that would answer by comment
 * id alone, and none is needed while a comment is always read under its content.
 */
export async function requireCommentAccess(
  contentId: string,
  commentId: string,
  userId: string,
  action: AccessAction,
): Promise<Comment> {
  const comment = await getComment(contentId, commentId);
  if (!comment) throw new HttpError(404, 'Comment not found');

  await requireOrganizationAccess(userId, comment.organizationId, action);
  return comment;
}

/**
 * Authorizes a change only the author of a comment may make.
 *
 * Reading the organization is not enough to edit someone else's words: a course
 * editor curates a discussion, they do not speak in it.
 */
export async function requireCommentAuthor(
  contentId: string,
  commentId: string,
  userId: string,
): Promise<Comment> {
  const comment = await getComment(contentId, commentId);
  if (!comment) throw new HttpError(404, 'Comment not found');

  await requireOrganizationAccess(userId, comment.organizationId, 'read');
  if (comment.authorId !== userId) {
    throw new HttpError(403, 'Only the author can change this comment');
  }
  return comment;
}

/**
 * Authorizes taking a comment down: its author, or an admin or editor of the
 * organization moderating the discussion.
 *
 * The author is checked against reading access because they are acting on their
 * own words; anyone else has to hold a write role, which is what keeps a viewer
 * from deleting other people's comments.
 */
export async function requireCommentModerator(
  contentId: string,
  commentId: string,
  userId: string,
): Promise<Comment> {
  const comment = await getComment(contentId, commentId);
  if (!comment) throw new HttpError(404, 'Comment not found');

  if (comment.authorId === userId) {
    await requireOrganizationAccess(userId, comment.organizationId, 'read');
    return comment;
  }

  await requireOrganizationAccess(userId, comment.organizationId, 'write');
  return comment;
}
