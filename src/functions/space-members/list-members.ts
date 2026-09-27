import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging, pathParam } from '../../lib/http';
import { getMembership } from '../../lib/organizations';
import {
  listSpaceMembers,
  spaceInvitationUrl,
  toApiSpaceMember,
} from '../../lib/space-members';

/**
 * A course's roster.
 *
 * Readable by everyone who can read the course — knowing who else is in the room
 * is part of being in it — but the addresses are for whoever may manage it, and
 * always for the person an outstanding invitation names, since it is their own.
 *
 * `canManage` is the caller's organization role, not their role in the course:
 * a viewer of the organization is a reader here even if they are the course's
 * instructor, because the roster is what the course's own settings govern.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await requireSpaceAccess(spaceId, user.userId, 'read');
  const membership = await getMembership(space.organizationId, user.userId);
  const canManage = membership?.status === 'ACTIVE' && membership.role !== 'VIEWER';

  const { members, lastEvaluatedKey } = await listSpaceMembers(spaceId, parsePaging(event));

  return ok({
    members: members.map((member) => toApiSpaceMember(member, user, canManage)),
    canManage,
    ...(canManage ? { inviteUrl: spaceInvitationUrl(space.organizationId, spaceId) } : {}),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
