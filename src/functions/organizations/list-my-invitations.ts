import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import { normalizeEmail } from '../../lib/members';
import { batchGetOrganizationsById, listInvitationsForEmail } from '../../lib/organizations';
import type { MyInvitation } from '../../types';

/**
 * The invitations waiting for the caller, across every organization.
 *
 * This is the one thing a person who belongs nowhere yet can read. It is scoped
 * to the caller by construction rather than by a check: the query is by the
 * address on their own verified claims, so it cannot return an invitation that
 * was not addressed to them. That is also why it needs no organization to
 * authorize against — being invited to one is not access to it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const email = user.email ? normalizeEmail(user.email) : '';
  if (!email) return ok({ invitations: [] });

  const invitations = await listInvitationsForEmail(email);
  if (invitations.length === 0) return ok({ invitations: [] });

  const organizations = await batchGetOrganizationsById(invitations.map((invitation) => invitation.orgId));

  const mine: MyInvitation[] = [];
  for (const invitation of invitations) {
    const organization = organizations.get(invitation.orgId);
    // An invitation whose organization has gone is not an offer to make.
    if (!organization) continue;
    mine.push({
      orgId: invitation.orgId,
      organizationName: organization.name,
      role: invitation.role,
      ...(invitation.invitedBy ? { invitedBy: invitation.invitedBy } : {}),
      invitedAt: invitation.joinedAt,
    });
  }

  return ok({ invitations: mine });
}

export const handler = handle(main);
