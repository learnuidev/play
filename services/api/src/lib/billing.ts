import type { BillingEntry, Payment, Space } from '../types';
import { batchGetItems } from './dynamodb';
import { isRefundable, refundDeadlineOf } from './payments';
import { SPACES_TABLE } from './spaces';

/**
 * A purchase, as the person who made it reads it.
 *
 * The one place the payment row becomes what a receipt says, so the billing
 * history and the answer to a refund draw the same sentence about the same
 * payment. Two things happen here that a client must not do for itself:
 *
 * - **the course's title is read**, rather than stored on the row. A course gets
 *   renamed, and a copy of its title on every receipt would be a copy that goes
 *   stale — which is why a receipt read a year later says what the course is
 *   called *now*, and why a deleted course reads as an empty title rather than
 *   as a purchase of nothing;
 * - **the refund window becomes an answer** — open, and until when — because the
 *   30 days are this service's rule and a screen with its own arithmetic would
 *   be a second copy of it, drifting on the day the number changes.
 */
export async function toBillingEntries(payments: Payment[]): Promise<BillingEntry[]> {
  const spaceIds = [...new Set(payments.map((payment) => payment.spaceId))];
  const spaces = spaceIds.length
    ? await batchGetItems<Space>(
        SPACES_TABLE,
        spaceIds.map((spaceId) => ({ spaceId })),
      )
    : [];
  const titles = new Map(spaces.map((space) => [space.spaceId, space.title]));

  return payments.map((payment) => {
    const refundable = isRefundable(payment);
    const deadline = refundDeadlineOf(payment);
    return {
      paymentId: payment.paymentId,
      spaceId: payment.spaceId,
      courseTitle: titles.get(payment.spaceId) ?? '',
      status: payment.status,
      amountCents: payment.amountCents,
      currency: payment.currency,
      createdAt: payment.createdAt,
      ...(payment.paidAt ? { paidAt: payment.paidAt } : {}),
      ...(payment.refundedAt ? { refundedAt: payment.refundedAt } : {}),
      refundable,
      // Only for the payments that are still inside the window: a closed one has
      // no deadline to show, and printing the date it closed on under a receipt
      // that is already refunded is a countdown to nothing.
      ...(refundable && deadline ? { refundDeadline: deadline } : {}),
    };
  });
}
