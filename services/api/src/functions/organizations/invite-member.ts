import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAdmin } from '../../lib/access';
import { displayNameOf, requireUser } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { invitationUrl, isValidEmail, normalizeEmail, sendInvitationFor, toApiMember } from '../../lib/members';
import { AlreadyAMemberError, getMembership, getOrganization, putInvitation } from '../../lib/organizations';
import { ORG_ROLES } from '../../types';
import type { OrgRole } from '../../types';

interface InviteMemberBody {
  email?: string;
  role?: string;
}

/**
 * Invites an email address to the organization with a role, and emails them.
 *
 * Nobody has to have signed up: the invitation is written against the address,
 * and whoever can sign in as that address claims it. That is also why an
 * invitation grants nothing until it is accepted — it is an offer, not a
 * membership.
 *
 * The invitation is written *before* the email is sent, and the send never
 * fails the request: an admin whose mail is misconfigured (no verified sender,
 * an account still in the SES sandbox) still has a real offer to hand over, and
 * the response says plainly whether the email went out.
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

  let member;
  try {
    member = await putInvitation({ orgId, email, role, invitedBy: user.userId });
  } catch (err) {
    if (err instanceof AlreadyAMemberError) throw new HttpError(409, err.message);
    throw err;
  }

  const organization = await getOrganization(orgId);
  const delivery = await sendInvitationFor({
    invitation: member,
    organizationName: organization?.name ?? 'an organization',
    inviterName: displayNameOf(user),
  });

  return ok(
    {
      member: toApiMember(member, user, true),
      delivery,
      // Carried in the response whether or not the email went out: the admin is
      // the fallback delivery mechanism, and the link is the offer itself.
      inviteUrl: invitationUrl(orgId),
    },
    201,
  );
}

export const handler = handle(main);
