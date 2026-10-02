import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { toBillingEntries } from '../../lib/billing';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { getPayment, isRefundable, paidAtOf, REFUND_WINDOW_DAYS, setPaymentStatus } from '../../lib/payments';
import { deleteSpaceMember, getSpaceMember } from '../../lib/space-members';
import { refundPaymentIntent } from '../../lib/stripe';

/**
 * Asking for a purchase back, inside the 30 days.
 *
 * ## Who may ask, and for what
 *
 * The buyer, for their own payment, within thirty days of paying it. The row is
 * looked up and then checked against the caller's own `sub` — every other read
 * of a payment in this service is scoped by construction, and this is the one
 * route that takes a payment id, so the check is the whole of its authorization.
 * Somebody else's payment answers 404 rather than 403: a stranger must not learn
 * which payment ids exist by asking for refunds on them.
 *
 * A payment that cannot be refunded is a **409 that says why**, in the three
 * sentences there are: it is already refunded, its 30 days are up, or it was
 * never paid. A client that had to guess from a bare failure would print the
 * wrong one.
 *
 * ## What it does, in the order it does it
 *
 * 1. **Stripe refunds the charge.** Nothing is written until this succeeds: the
 *    money going back is the thing that was asked for, and a row marked refunded
 *    under a charge that was not would be a lie a support question would have to
 *    unpick.
 * 2. **The row moves to `REFUNDED`**, with the moment it happened. The webhook
 *    will hear `charge.refunded` for the same charge a moment later and write the
 *    same status; two paths to one fact, and the row's own `updatedAt` is the
 *    only thing either of them changes twice.
 * 3. **The course is taken away.** This is the one place a refund *does* remove
 *    the enrolment, and it is the opposite of what the webhook does on purpose:
 *    the webhook is told money moved by somebody who is not here to be asked, and
 *    this is the learner themselves saying they want the purchase undone. Leaving
 *    access in place would be the product giving a course away. **Progress is
 *    untouched** — `deleteSpaceMember` removes the membership, not the
 *    completions — so buying it again resumes rather than restarts, exactly as
 *    leaving and registering again does for a free course. A membership that is
 *    not a student's is left alone: a refund ends a purchase, and it is nobody's
 *    way of removing an instructor from a course they teach.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const paymentId = pathParam(event, 'paymentId');

  const payment = await getPayment(paymentId);
  if (!payment || payment.userId !== user.userId) {
    throw new HttpError(404, 'No such payment');
  }

  if (payment.status === 'REFUNDED') {
    throw new HttpError(409, 'This payment has already been refunded.');
  }
  if (payment.status !== 'PAID') {
    // PENDING, FAILED and EXPIRED are all "no money was taken", and the sentence
    // says which of the three by saying the one thing they share.
    throw new HttpError(409, 'This payment was never completed, so there is nothing to refund.');
  }
  if (!payment.stripePaymentIntentId) {
    // Checked before the window, because `isRefundable` reads this field too: a
    // PAID row with no intent would otherwise be refused with a sentence about
    // 30 days that have not passed. It is unreachable through the product —
    // every PAID row the webhook writes has an intent — so it is a 500 rather
    // than a message, which is what a broken row deserves.
    throw new Error(`Payment ${paymentId} is PAID with no Stripe payment intent to refund`);
  }
  if (!isRefundable(payment)) {
    throw new HttpError(
      409,
      `This course was bought on ${new Date(paidAtOf(payment)).toISOString().slice(0, 10)}, ` +
        `and the ${REFUND_WINDOW_DAYS} days to ask for a refund have passed.`,
    );
  }

  await refundPaymentIntent(payment.stripePaymentIntentId);
  await setPaymentStatus(payment.paymentId, 'REFUNDED');

  const member = await getSpaceMember(payment.spaceId, user.userId);
  if (member && member.status === 'ACTIVE' && member.role === 'STUDENT') {
    await deleteSpaceMember(payment.spaceId, user.userId);
  }

  // Read back rather than assembled from what was sent: the answer is the
  // receipt as this service now holds it, and a client that shows what it just
  // wrote is a client that cannot be told it was wrong.
  const refunded = await getPayment(payment.paymentId);
  const [entry] = await toBillingEntries(refunded ? [refunded] : []);
  return ok({ payment: entry });
}

export const handler = handle(main);
