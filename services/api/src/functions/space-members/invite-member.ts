import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { displayNameOf, requireUser } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { isValidEmail, normalizeEmail } from '../../lib/members';
import { getOrganization } from '../../lib/organizations';
import {
  AlreadyInSpaceError,
  getSpaceMember,
  putSpaceInvitation,
  sendSpaceInvitationFor,
  spaceInvitationUrl,
  toApiSpaceMember,
} from '../../lib/space-members';
import { SPACE_MEMBER_ROLES } from '../../types';
import type { SpaceMemberRole } from '../../types';

interface InviteSpaceMemberBody {
  email?: string;
  role?: string;
}

/**
 * Invites an email address to a course, and emails them.
 *
 * Nobody has to be in the organization, or to have signed up: the invitation is
 * written against the address and whoever can sign in as that address claims it.
 * That is what makes a course shareable with a guest — and also why an
 * invitation grants nothing at all until it is accepted.
 *
 * The invitation is written *before* the email is sent, and the send never fails
 * the request: an inviter whose mail is misconfigured still has a real offer to
 * hand over, and the response says plainly whether the email went out.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await requireSpaceAccess(spaceId, user.userId, 'write');
  const body = jsonBody<InviteSpaceMemberBody>(event);

  const email = normalizeEmail(body.email ?? '');
  const role = (body.role ?? 'STUDENT') as SpaceMemberRole;

  if (!email) throw new HttpError(400, 'email is required');
  if (!isValidEmail(email)) throw new HttpError(400, 'email must be a valid email address');
  if (!SPACE_MEMBER_ROLES.includes(role)) {
    throw new HttpError(400, `role must be one of ${SPACE_MEMBER_ROLES.join(', ')}`);
  }
  // Inviting yourself is not an invitation: the row would be addressed to the
  // person who wrote it, and they are already able to read the course.
  if (user.email && normalizeEmail(user.email) === email) {
    throw new HttpError(400, 'You are already able to read this course');
  }

  const existing = await getSpaceMember(spaceId, email);
  if (existing?.status === 'ACTIVE') {
    throw new HttpError(409, `${email} is already a member of this course`);
  }

  let member;
  try {
    member = await putSpaceInvitation({
      spaceId,
      organizationId: space.organizationId,
      email,
      role,
      invitedBy: user.userId,
    });
  } catch (err) {
    if (err instanceof AlreadyInSpaceError) throw new HttpError(409, err.message);
    throw err;
  }

  const organization = await getOrganization(space.organizationId);
  const delivery = await sendSpaceInvitationFor({
    invitation: member,
    spaceTitle: space.title,
    organizationName: organization?.name ?? 'an organization',
    inviterName: displayNameOf(user),
  });

  return ok(
    {
      member: toApiSpaceMember(member, user, true),
      delivery,
      // Carried whether or not the email went out: the inviter is the fallback
      // delivery mechanism, and the link is the offer itself.
      inviteUrl: spaceInvitationUrl(space.organizationId, spaceId),
    },
    201,
  );
}

export const handler = handle(main);
