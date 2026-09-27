import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging, pathParam } from '../../lib/http';
import { invitationUrl, toApiMember } from '../../lib/members';
import { getOrganization, listMembers } from '../../lib/organizations';

/**
 * The organization's roster.
 *
 * Readable by every member — knowing who else is in the room is part of being
 * in it — but only an admin is shown email addresses, because only an admin can
 * do anything with one. Admins also get the invitation link, which is the
 * invite path that does not depend on mail being set up at all.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');

  const role = await requireOrganizationAccess(user.userId, orgId, 'read');
  const organization = await getOrganization(orgId);

  const { members, lastEvaluatedKey } = await listMembers(orgId, parsePaging(event));

  return ok({
    members: members.map((member) => toApiMember(member, user, role === 'ADMIN')),
    role,
    ownerId: organization?.ownerId,
    ...(role === 'ADMIN' ? { inviteUrl: invitationUrl(orgId) } : {}),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
