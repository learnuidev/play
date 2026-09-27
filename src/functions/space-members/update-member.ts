import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { HttpError, decodedPathParam, handle, jsonBody, ok, pathParam } from '../../lib/http';
import {
  SpaceMemberNotFoundError,
  getSpaceMember,
  toApiSpaceMember,
  updateSpaceMemberRole,
} from '../../lib/space-members';
import { SPACE_MEMBER_ROLES } from '../../types';
import type { SpaceMemberRole } from '../../types';

interface UpdateSpaceMemberBody {
  role?: string;
}

/**
 * Changes what somebody is to a course: a student, an assistant, an instructor.
 *
 * A pending invitation may be edited the same way — an offer nobody has accepted
 * is still an offer, and correcting the role it names is better than withdrawing
 * it and starting again.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');
  // The id may be an email address while an invitation is outstanding, so it
  // arrives percent-encoded and is decoded here.
  const memberId = decodedPathParam(event, 'userId');

  await requireSpaceAccess(spaceId, user.userId, 'write');

  const body = jsonBody<UpdateSpaceMemberBody>(event);
  const role = (body.role ?? '') as SpaceMemberRole;
  if (!SPACE_MEMBER_ROLES.includes(role)) {
    throw new HttpError(400, `role must be one of ${SPACE_MEMBER_ROLES.join(', ')}`);
  }

  const member = await getSpaceMember(spaceId, memberId);
  if (!member) throw new HttpError(404, 'This person is not in this course');

  try {
    await updateSpaceMemberRole(spaceId, memberId, role);
  } catch (err) {
    if (err instanceof SpaceMemberNotFoundError) {
      throw new HttpError(404, 'This person is not in this course');
    }
    throw err;
  }

  return ok({ member: toApiSpaceMember({ ...member, role }, user, true) });
}

export const handler = handle(main);
