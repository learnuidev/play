import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAdmin } from '../../lib/access';
import { displayNameOf, requireUser } from '../../lib/auth';
import { HttpError, decodedPathParam, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { sendInvitationFor, toApiMember } from '../../lib/members';
import { getMembership, getOrganization, putInvitation } from '../../lib/organizations';
import { ORG_ROLES } from '../../types';
import type { OrgRole } from '../../types';

interface ResendInvitationBody {
  /**
   * Optional. An invitation that has not been accepted yet is still editable,
   * so re-sending is also the moment to fix the role it offers — otherwise the
   * admin would have to withdraw it and invite again.
   */
  role?: string;
}

/**
 * Sends an outstanding invitation again, to the address it was made to.
 *
 * Addressed by the invitation's own id (the email address, until it is
 * accepted), not by a body field: which invitation is being re-sent is part of
 * the path, and the address it goes to is a property of that invitation rather
 * than something the caller gets to restate.
 *
 * Only a *pending* invitation can be re-sent. An address that already belongs
 * to the organization is a member, and "re-sending" an offer they have already
 * taken up is not a thing — it answers 409 like any other attempt to invite an
 * existing member.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');
  const memberUserId = decodedPathParam(event, 'userId');

  await requireOrganizationAdmin(user.userId, orgId);

  const member = await getMembership(orgId, memberUserId);
  if (!member) throw new HttpError(404, 'Member not found');
  if (member.status !== 'INVITED') {
    throw new HttpError(409, `${memberUserId} is already a member of this organization`);
  }

  const body = jsonBody<ResendInvitationBody>(event);
  const role = body.role === undefined ? member.role : (body.role as OrgRole);
  if (!ORG_ROLES.includes(role)) {
    throw new HttpError(400, `role must be one of ${ORG_ROLES.join(', ')}`);
  }

  // The row is written again rather than left as it is: `joinedAt` is the
  // invitation's own timestamp and a re-send is a new one, and the same write
  // carries any role correction. An invitation is an offer, not a membership,
  // so there is no counter to move and nothing to guard — the check above that
  // it is still pending is the whole of it.
  const invitation = await putInvitation({
    orgId,
    email: member.invitedEmail ?? member.userId,
    role,
    invitedBy: user.userId,
  });

  const organization = await getOrganization(orgId);
  const delivery = await sendInvitationFor({
    invitation,
    organizationName: organization?.name ?? 'an organization',
    inviterName: displayNameOf(user),
  });

  return ok({
    member: toApiMember(invitation, user, true),
    delivery,
  });
}

export const handler = handle(main);
