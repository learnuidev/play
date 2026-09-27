import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { batchGetItems } from '../../lib/dynamodb';
import { handle, ok } from '../../lib/http';
import { normalizeEmail } from '../../lib/members';
import { batchGetOrganizationsById } from '../../lib/organizations';
import { listSpaceInvitationsForEmail } from '../../lib/space-members';
import { SPACES_TABLE } from '../../lib/spaces';
import type { MySpaceInvitation, Space } from '../../types';

/**
 * The course invitations waiting for the caller, across every organization.
 *
 * Like its organization counterpart, this is the one thing somebody who belongs
 * nowhere yet can read, and it is scoped to the caller by construction rather
 * than by a check: the query is by the address on their own verified claims, so
 * it cannot return an invitation that was not addressed to them. The course and
 * the organization are fetched afterwards — the recipient is entitled to know
 * what they are being offered, and the invitation itself grants nothing.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const email = user.email ? normalizeEmail(user.email) : '';
  if (!email) return ok({ invitations: [] });

  const invitations = await listSpaceInvitationsForEmail(email);
  if (invitations.length === 0) return ok({ invitations: [] });

  const [spaces, organizations] = await Promise.all([
    batchGetItems<Space>(
      SPACES_TABLE,
      invitations.map((invitation) => ({ spaceId: invitation.spaceId })),
    ),
    batchGetOrganizationsById(invitations.map((invitation) => invitation.organizationId)),
  ]);

  const spacesById = new Map(spaces.map((space) => [space.spaceId, space]));

  const mine: MySpaceInvitation[] = [];
  for (const invitation of invitations) {
    const space = spacesById.get(invitation.spaceId);
    // An invitation to a course that has gone is not an offer to make.
    if (!space) continue;
    mine.push({
      spaceId: space.spaceId,
      spaceTitle: space.title,
      orgId: space.organizationId,
      organizationName: organizations.get(space.organizationId)?.name ?? '',
      role: invitation.role,
      ...(invitation.invitedBy ? { invitedBy: invitation.invitedBy } : {}),
      invitedAt: invitation.joinedAt,
    });
  }

  return ok({ invitations: mine });
}

export const handler = handle(main);
