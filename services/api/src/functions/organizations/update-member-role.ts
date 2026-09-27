import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAdmin } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { HttpError, decodedPathParam, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { toApiMember } from '../../lib/members';
import { LastAdminError, MemberNotFoundError, getMembership, getOrganization, updateMemberRole } from '../../lib/organizations';
import { ORG_ROLES } from '../../types';
import type { OrgRole } from '../../types';

interface UpdateMemberBody {
  role?: string;
}

/**
 * Changes what a member may do: admin, editor, or viewer.
 *
 * Admin-only, and the role of an invitation can be corrected the same way —
 * which is why the target is addressed by its key rather than by a `sub`: for
 * an invitation, that key is the address it was sent to.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');
  const memberUserId = decodedPathParam(event, 'userId');

  await requireOrganizationAdmin(user.userId, orgId);

  const body = jsonBody<UpdateMemberBody>(event);
  const role = (body.role ?? '') as OrgRole;

  if (!ORG_ROLES.includes(role)) {
    throw new HttpError(400, `role must be one of ${ORG_ROLES.join(', ')}`);
  }

  const member = await getMembership(orgId, memberUserId);
  if (!member) throw new HttpError(404, 'Member not found');

  // The organization's owner can be neither demoted nor removed while they own
  // it: `ownerId` is what the organization is attributed to, and nothing yet
  // hands ownership on, so a demoted owner would be an organization whose owner
  // has no say in it.
  const organization = await getOrganization(orgId);
  if (organization?.ownerId === memberUserId && member.status === 'ACTIVE' && role !== 'ADMIN') {
    throw new HttpError(409, 'The owner of this organization cannot be demoted');
  }

  try {
    await updateMemberRole(orgId, memberUserId, role, {
      status: member.status,
      role: member.role,
    });
  } catch (err) {
    if (err instanceof LastAdminError) throw new HttpError(409, err.message);
    if (err instanceof MemberNotFoundError) throw new HttpError(404, 'Member not found');
    throw err;
  }

  return ok({ member: toApiMember({ ...member, role }, user, true) });
}

export const handler = handle(main);
