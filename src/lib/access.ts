import { getContent } from './contents';
import { getComment } from './comments';
import { getVideo } from './dynamodb';
import { HttpError } from './http';
import { getMembership } from './organizations';
import { getSection } from './sections';
import { getSpace } from './spaces';
import type { Comment, Content, OrgRole, Section, Space, Video } from '../types';

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
 * Loads a video and authorizes the caller against it.
 *
 * A video belongs to the organization it was uploaded to: every member of that
 * organization can read it, its admins and editors can change it. Its uploader
 * keeps access either way — which is also what keeps a video created before
 * organizations existed (one with no `organizationId`) reachable by its owner,
 * and what stops the organization backfill from locking anyone out of their own
 * uploads.
 */
export async function requireVideoAccess(
  videoId: string,
  userId: string,
  action: AccessAction,
): Promise<Video> {
  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');

  if (video.ownerId === userId) return video;

  if (video.organizationId) {
    await requireOrganizationAccess(userId, video.organizationId, action);
    return video;
  }

  throw new HttpError(403, 'Forbidden');
}

/**
 * Loads a space and authorizes the caller against the organization that owns it.
 *
 * Unlike a video, a space has no personal-owner escape hatch: it is always
 * organization property, so access is exactly membership of that organization.
 */
export async function requireSpaceAccess(
  spaceId: string,
  userId: string,
  action: AccessAction,
): Promise<Space> {
  const space = await getSpace(spaceId);
  if (!space) throw new HttpError(404, 'Space not found');

  await requireOrganizationAccess(userId, space.organizationId, action);
  return space;
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

  await requireOrganizationAccess(userId, section.organizationId, action);
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

  await requireOrganizationAccess(userId, content.organizationId, action);
  return content;
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
 * Authorizes a change to a comment that is the author's own business: reading
 * the organization is not enough to edit someone else's words.
 *
 * Returns the role the caller holds, so a handler can additionally allow an
 * admin or editor to moderate — the shape `requireOrganizationAccess` already
 * uses.
 */
export async function requireCommentAuthor(
  contentId: string,
  commentId: string,
  userId: string,
): Promise<{ comment: Comment; role: OrgRole }> {
  const comment = await getComment(contentId, commentId);
  if (!comment) throw new HttpError(404, 'Comment not found');

  const role = await requireOrganizationAccess(userId, comment.organizationId, 'read');
  if (comment.authorId !== userId && role === 'VIEWER') {
    throw new HttpError(403, 'Only the author can change this comment');
  }
  return { comment, role };
}
