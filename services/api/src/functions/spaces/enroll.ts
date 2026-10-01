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
 * **Except when it costs something.** A course with a price is not joined here:
 * registering would be handing over the course for free, which is the one way
 * this route could lose an author money. The caller is told the course is paid
 * and how much, and the way in is the checkout, whose webhook calls the very same
 * `enrollInSpace` below once Stripe says the money arrived. A course is free
 * exactly when it has no price — see `Space.priceCents`.
 *
 * An invitation still beats a price: somebody the author put in the course by
 * name is accepted here whatever it costs, because the offer *is* the permission
 * and asking them to pay for it would be asking them to buy what they were given.
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

  // The price, checked *after* the invitation above and before anything is
  // written: a paid course is joined by paying, and this route is not a way round
  // that. 402 rather than 403 because it is not a permission the caller lacks —
  // it is a price they have not paid, and the body says what it is.
  //
  // Somebody who *has* paid never reaches this: the webhook enrolled them through
  // the same `enrollInSpace` below, so the check at the top of this handler
  // already returned their membership. That is why there is no "did they pay?"
  // lookup here — the membership is the record of payment, and asking Stripe or
  // the payments table as a second opinion would be a second answer to one
  // question.
  const priceCents = space.priceCents ?? 0;
  if (priceCents > 0) {
    throw new HttpError(
      402,
      `"${space.title}" costs ${formatPrice(priceCents, space.currency)} — check out to join it.`,
    );
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

/**
 * `1250` and `usd` → `$12.50`, for the one sentence that names a price.
 *
 * Formatted here rather than sent as a number, because the caller's browser is
 * the only place that knows their locale and this message is rendered *before*
 * any catalogue page can format anything. `en-US` is the fallback the product
 * already writes its mail in; a marketplace that localises its prices will want
 * the number and the currency instead, and that is a change to this sentence.
 */
function formatPrice(cents: number, currency?: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency ?? 'usd').toUpperCase(),
  }).format(cents / 100);
}
