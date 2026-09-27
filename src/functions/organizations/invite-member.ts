import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAdmin } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { isValidEmail, normalizeEmail, toApiMember } from '../../lib/members';
import { AlreadyAMemberError, getMembership, putInvitation } from '../../lib/organizations';
import { ORG_ROLES } from '../../types';
import type { OrgRole } from '../../types';

interface InviteMemberBody {
  email?: string;
  role?: string;
}

/**
 * Invites an email address to the organization with a role.
 *
 * Nobody has to have signed up: the invitation is written against the address,
 * and whoever can sign in as that address claims it from the Members page. That
 * is also why an invitation grants nothing until it is accepted — it is an
 * offer, not a membership.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');

  await requireOrganizationAdmin(user.userId, orgId);

  const body = jsonBody<InviteMemberBody>(event);

  const email = normalizeEmail(body.email ?? '');
  const role = (body.role ?? '') as OrgRole;

  if (!email) throw new HttpError(400, 'email is required');
  if (!isValidEmail(email)) throw new HttpError(400, 'email must be a valid email address');
  if (!ORG_ROLES.includes(role)) {
    throw new HttpError(400, `role must be one of ${ORG_ROLES.join(', ')}`);
  }
  // The inviter is reading their own address off the invitation, and the row
  // would be addressed to the same person it was written by.
  if (user.email && normalizeEmail(user.email) === email) {
    throw new HttpError(400, 'You are already a member of this organization');
  }

  // An account that already belongs here is not invited again: the roster
  // answers 409 rather than silently sending an offer nobody can accept, and
  // rather than letting a re-invite rewrite the role of a real member.
  const existing = await getMembership(orgId, email);
  if (existing?.status === 'ACTIVE') {
    throw new HttpError(409, `${email} is already a member of this organization`);
  }

  try {
    const member = await putInvitation({
      orgId,
      email,
      role,
      invitedBy: user.userId,
    });

    return ok({ member: toApiMember(member, user, true) }, 201);
  } catch (err) {
    if (err instanceof AlreadyAMemberError) throw new HttpError(409, err.message);
    throw err;
  }
}

export const handler = handle(main);
