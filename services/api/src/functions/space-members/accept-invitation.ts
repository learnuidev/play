import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSpace } from '../../lib/spaces';
import { requireUser } from '../../lib/auth';
import { isConditionalCheckFailed } from '../../lib/dynamodb';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { normalizeEmail } from '../../lib/members';
import {
  acceptSpaceInvitation,
  getSpaceMember,
  listSpaceInvitationsForEmail,
  toApiSpaceMember,
} from '../../lib/space-members';

/**
 * Claims the course invitation addressed to the caller's email address.
 *
 * No token and no approval step: an invitation names an address, Cognito has
 * already verified that the caller owns it — the claims on the request are the
 * proof — so being signed in as the invited address *is* the acceptance. The row
 * moves from the email key to the caller's `sub` in one transaction.
 *
 * No organization membership is needed, and none is created: this is the course
 * being joined, and the course is what an invitation to it offers.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const email = user.email ? normalizeEmail(user.email) : '';
  if (!email) {
    throw new HttpError(400, 'Your account has no email address to match the invitation against');
  }

  // Read before anything else so that an invitation to a course that has since
  // been deleted is a 404 rather than a membership pointing at nothing.
  const space = await getSpace(spaceId);
  if (!space) throw new HttpError(404, 'Space not found');

  // Being in the course already is a success, not a conflict: the caller asked
  // to be in it and they are, whichever way they got there.
  const existing = await getSpaceMember(spaceId, user.userId);
  if (existing?.status === 'ACTIVE') {
    return ok({ member: toApiSpaceMember(existing, user, true) });
  }

  const invitations = (await listSpaceInvitationsForEmail(email)).filter(
    (invitation) => invitation.spaceId === spaceId,
  );
  if (invitations.length === 0) {
    throw new HttpError(404, 'No invitation for your email address in this course');
  }

  try {
    const accepted = await acceptSpaceInvitation({
      invitation: invitations[0],
      userId: user.userId,
      email,
    });
    return ok({ member: toApiSpaceMember(accepted, user, true) });
  } catch (err) {
    // Two taps, or a race with the caller's own other tab: the second finds the
    // membership already written, which is the outcome it wanted.
    if (isConditionalCheckFailed(err) || isTransactionCanceled(err)) {
      const settled = await getSpaceMember(spaceId, user.userId);
      if (settled?.status === 'ACTIVE') {
        return ok({ member: toApiSpaceMember(settled, user, true) });
      }
      throw new HttpError(409, 'This invitation is no longer available');
    }
    throw err;
  }
}

/** Whether a transaction was called off by one of its conditions. */
function isTransactionCanceled(err: unknown): boolean {
  return err instanceof Error && err.name === 'TransactionCanceledException';
}

export const handler = handle(main);
