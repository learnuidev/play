import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';
import { findPaidPayment, REFUND_WINDOW_DAYS } from '../../lib/payments';
import { deleteSpaceMember, getSpaceMember } from '../../lib/space-members';

/**
 * Drops the caller out of a course.
 *
 * The mirror of registering, and the reason a learner can undo a decision made
 * on a front page. What it removes is the membership — the row *is* the
 * relationship — and what it leaves behind is the course: the organization that
 * wrote it still owns it, and the progress the caller made stays with their
 * account, so registering again resumes rather than restarts.
 *
 * ## A course that was bought cannot be left
 *
 * A purchase has a way out of its own — asking for the money back inside the
 * 30 days — and it is deliberately *not* this one. Leaving is instant and
 * silent: it would take somebody out of a course they paid for without touching
 * the payment, leaving them with neither the course nor a refund, and no record
 * that they had asked for either. So a paid enrolment is refused here, with a
 * sentence that names the door that does exist, and the marketplace does not
 * offer the button for one.
 *
 * What counts is the **payment and not the price**: a course that costs money
 * and a learner who was invited into it for nothing are two different
 * relationships, and only the second one is this route's to undo.
 *
 * Nothing else is checked but that they are in it: an instructor may leave a
 * course they no longer run, and somebody who was never in it gets a 404 rather
 * than a silent success, because "you are not in this course" is worth saying.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const member = await getSpaceMember(spaceId, user.userId);
  if (!member || member.status !== 'ACTIVE') {
    throw new HttpError(404, 'You are not in this course');
  }

  if (await findPaidPayment(user.userId, spaceId)) {
    throw new HttpError(
      409,
      'You bought this course, so it cannot be left. If you want your money back, ' +
        `ask for a refund from your billing history within ${REFUND_WINDOW_DAYS} days of buying it.`,
    );
  }

  await deleteSpaceMember(spaceId, user.userId);
  return noContent();
}

export const handler = handle(main);
