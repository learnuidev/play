import { getVideo } from './dynamodb';
import { HttpError } from './http';
import { getMembership } from './organizations';
import { getSpace } from './spaces';
import type { OrgRole, Space, Video } from '../types';

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
