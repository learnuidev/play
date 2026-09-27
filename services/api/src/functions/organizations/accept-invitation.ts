import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { normalizeEmail, toApiMember } from '../../lib/members';
import { acceptInvitation, getMembership, listInvitationsForEmail } from '../../lib/organizations';
import { isConditionalCheckFailed } from '../../lib/dynamodb';

/**
 * Claims the invitation addressed to the caller's email address.
 *
 * There is no inviter-side approval and no token to carry: an invitation names
 * an address, Cognito has already verified that the caller owns that address
 * (the claims on the request are the proof), so being signed in as the invited
 * address *is* the acceptance. The row moves from the email key to the caller's
 * `sub` in one transaction.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');

  const email = user.email ? normalizeEmail(user.email) : '';
  if (!email) {
    throw new HttpError(400, 'Your account has no email address to match the invitation against');
  }

  const invitations = (await listInvitationsForEmail(email)).filter(
    (invitation) => invitation.orgId === orgId,
  );
  if (invitations.length === 0) {
    throw new HttpError(404, 'No invitation for your email address in this organization');
  }

  // Belonging already is a success, not a conflict: the caller asked to be in
  // the organization and they are — whoever added them, however they got here.
  const existing = await getMembership(orgId, user.userId);
  if (existing?.status === 'ACTIVE') {
    return ok({ member: toApiMember(existing, user, true) });
  }

  const invitation = invitations[0];
  try {
    const accepted = await acceptInvitation({ invitation, userId: user.userId, email });
    return ok({ member: toApiMember(accepted, user, true) });
  } catch (err) {
    // Two taps, or a race with the caller's own other tab: the second one finds
    // the membership already written, which is the outcome it wanted.
    if (isConditionalCheckFailed(err) || isTransactionCanceled(err)) {
      const settled = await getMembership(orgId, user.userId);
      if (settled?.status === 'ACTIVE') {
        return ok({ member: toApiMember(settled, user, true) });
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
