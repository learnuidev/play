import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { isConditionalCheckFailed } from '../../lib/dynamodb';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { normalizeEmail } from '../../lib/members';
import {
  AlreadyEnrolledError,
  acceptSpaceInvitation,
  enrollInSpace,
  getSpaceMember,
  listSpaceInvitationsForEmail,
  toApiSpaceMember,
} from '../../lib/space-members';
import { getSpace } from '../../lib/spaces';

/**
 * Registers the caller for a course.
 *
 * The marketplace's one write: somebody read a listed course, decided to take
 * it, and this is them joining. Signing in is the whole of the proof — there is
 * nothing else to check, because a listed course is one its author has offered
 * to anyone who asks.
 *
 * Registering is idempotent, and an invitation already waiting for the caller's
 * address is *the* registration rather than something beside it: the row moves
 * from the invited address to their `sub`, keeping whatever role they were
 * offered. Somebody invited as an assistant and registering through the catalog
 * is an assistant, not a student.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await getSpace(spaceId);
  // An unlisted course is not "forbidden", it is not there: a stranger must not
  // be able to learn that a private course id exists by registering for it.
  if (!space || !space.listed) throw new HttpError(404, 'Course not found');

  // Already in it — however they got there — is the outcome they asked for.
  const existing = await getSpaceMember(spaceId, user.userId);
  if (existing?.status === 'ACTIVE') {
    return ok({ member: toApiSpaceMember(existing, user, true) });
  }

  const email = user.email ? normalizeEmail(user.email) : '';

  if (email) {
    const invitations = (await listSpaceInvitationsForEmail(email)).filter(
      (invitation) => invitation.spaceId === spaceId,
    );

    if (invitations.length > 0) {
      try {
        const accepted = await acceptSpaceInvitation({
          invitation: invitations[0],
          userId: user.userId,
          email,
        });
        return ok({ member: toApiSpaceMember(accepted, user, true) });
      } catch (err) {
        // A race with the caller's other tab, which registered them first: fall
        // through to the read below rather than failing a request that worked.
        if (!isConditionalCheckFailed(err)) throw err;
      }
    }
  }

  try {
    const member = await enrollInSpace({
      spaceId,
      organizationId: space.organizationId,
      userId: user.userId,
      ...(email ? { email } : {}),
    });
    return ok({ member: toApiSpaceMember(member, user, true) });
  } catch (err) {
    if (err instanceof AlreadyEnrolledError || isConditionalCheckFailed(err)) {
      const settled = await getSpaceMember(spaceId, user.userId);
      if (settled?.status === 'ACTIVE') {
        return ok({ member: toApiSpaceMember(settled, user, true) });
      }
    }
    throw err;
  }
}

export const handler = handle(main);
