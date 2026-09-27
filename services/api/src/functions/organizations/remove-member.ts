import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAdmin } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { HttpError, decodedPathParam, handle, noContent, pathParam } from '../../lib/http';
import { LastAdminError, MemberNotFoundError, deleteMember, getMembership, getOrganization } from '../../lib/organizations';

/**
 * Takes a membership off the roster.
 *
 * The same call revokes an invitation nobody accepted and removes a member who
 * joined: the row is the relationship, and deleting it ends it either way.
 * Admin-only, and the last admin cannot go — an organization with no admin is
 * one nobody can administer, not even to put someone back.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');
  const memberUserId = decodedPathParam(event, 'userId');

  await requireOrganizationAdmin(user.userId, orgId);

  const member = await getMembership(orgId, memberUserId);
  if (!member) throw new HttpError(404, 'Member not found');

  // The owner is attributed on the organization row, so they cannot simply walk
  // away from it: `ownerId` would be left pointing at somebody with no access.
  const organization = await getOrganization(orgId);
  if (organization?.ownerId === member.userId) {
    throw new HttpError(409, 'The owner of this organization cannot be removed');
  }

  try {
    await deleteMember(orgId, member);
  } catch (err) {
    if (err instanceof LastAdminError) throw new HttpError(409, err.message);
    if (err instanceof MemberNotFoundError) throw new HttpError(404, 'Member not found');
    throw err;
  }

  return noContent();
}

export const handler = handle(main);
