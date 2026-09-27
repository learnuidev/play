import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { displayNameOf, requireUser } from '../../lib/auth';
import { HttpError, decodedPathParam, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { getOrganization } from '../../lib/organizations';
import {
  getSpaceMember,
  sendSpaceInvitationFor,
  spaceInvitationUrl,
  toApiSpaceMember,
  updateSpaceMemberRole,
} from '../../lib/space-members';
import { SPACE_MEMBER_ROLES } from '../../types';
import type { SpaceMemberRole } from '../../types';

interface ResendInvitationBody {
  role?: string;
}

/**
 * Sends an outstanding course invitation again, optionally correcting its role.
 *
 * An invitation nobody has accepted is still an offer, so re-sending is also the
 * moment to fix it rather than withdraw it and start over. An accepted one is
 * not an invitation at all, and saying so beats emailing somebody an offer to
 * something they already have.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');
  const memberId = decodedPathParam(event, 'userId');

  const space = await requireSpaceAccess(spaceId, user.userId, 'write');
  const body = jsonBody<ResendInvitationBody>(event);

  const member = await getSpaceMember(spaceId, memberId);
  if (!member) throw new HttpError(404, 'This person is not in this course');
  if (member.status !== 'INVITED') {
    throw new HttpError(409, 'This person has already accepted their invitation');
  }

  let corrected = member;
  if (body.role !== undefined) {
    const role = body.role as SpaceMemberRole;
    if (!SPACE_MEMBER_ROLES.includes(role)) {
      throw new HttpError(400, `role must be one of ${SPACE_MEMBER_ROLES.join(', ')}`);
    }

    if (role !== member.role) {
      await updateSpaceMemberRole(spaceId, memberId, role);
      corrected = { ...member, role };
    }
  }

  const organization = await getOrganization(space.organizationId);
  const delivery = await sendSpaceInvitationFor({
    invitation: corrected,
    spaceTitle: space.title,
    organizationName: organization?.name ?? 'an organization',
    inviterName: displayNameOf(user),
  });

  return ok({
    member: toApiSpaceMember(corrected, user, true),
    delivery,
    inviteUrl: spaceInvitationUrl(space.organizationId, spaceId),
  });
}

export const handler = handle(main);
