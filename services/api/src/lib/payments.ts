import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { Payment, PaymentStatus } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';

export const PAYMENTS_TABLE = env.paymentsTableName;

/**
 * The one index this module reads.
 *
 * A refund and a failed payment arrive as events naming the *payment intent*,
 * and the session that started it is not in them — so without this index those
 * two events would be a scan of every payment in the table, or a row that never
 * gets updated.
 *
 * The table declares two more — what one person has bought, and who has bought
 * one course — and neither is read here yet: they are what the marketplace's own
 * screens will query, and they are declared with the table because an index added
 * later is an `UpdateTable` against a table that by then has rows in it.
 */
const PAYMENT_INTENT_INDEX = 'PaymentIntentIndex';

export async function getPayment(paymentId: string): Promise<Payment | undefined> {
  const res = await client.send(new GetCommand({ TableName: PAYMENTS_TABLE, Key: { paymentId } }));
  return res.Item as Payment | undefined;
}

/** The payment a Stripe payment intent belongs to, when the event names only that. */
export async function findPaymentByIntent(
  stripePaymentIntentId: string,
): Promise<Payment | undefined> {
  const res = await client.send(
    new QueryCommand({
      TableName: PAYMENTS_TABLE,
      IndexName: PAYMENT_INTENT_INDEX,
      KeyConditionExpression: '#intent = :intent',
      ExpressionAttributeNames: { '#intent': 'stripePaymentIntentId' },
      ExpressionAttributeValues: { ':intent': stripePaymentIntentId },
      // One intent belongs to one payment, so the first row is the answer and
      // there is no reason to page.
      Limit: 1,
    }),
  );
  return (res.Items ?? [])[0] as Payment | undefined;
}

/**
 * Writes what Stripe said about one checkout session.
 *
 * A `Put` rather than an update, and that is the idempotency: the row's key **is**
 * the session, so Stripe re-delivering the same event — which it does, on any
 * response that is not a 2xx — writes the same row again rather than adding a
 * second sale. `createdAt` is preserved across that, because the row appearing is
 * not the same event as the purchase happening, and a receipt should not change
 * its date because a webhook was retried.
 *
 * The status is written as given rather than guarded against: the events arrive
 * in the order Stripe emitted them, a later one is the newer truth, and a
 * conditional write here would have to know which direction "newer" is for every
 * pairing of five statuses.
 */
export async function recordPayment(input: {
  paymentId: string;
  spaceId: string;
  organizationId: string;
  userId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  email?: string;
  stripeCustomerId?: string;
  stripePaymentIntentId?: string;
  stripePriceId?: string;
  at?: number;
}): Promise<Payment> {
  const now = input.at ?? Date.now();
  const existing = await getPayment(input.paymentId);

  const payment: Payment = {
    paymentId: input.paymentId,
    spaceId: input.spaceId,
    organizationId: input.organizationId,
    userId: input.userId,
    status: input.status,
    amountCents: input.amountCents,
    currency: input.currency,
    ...(input.email ? { email: input.email } : {}),
    ...(input.stripeCustomerId ? { stripeCustomerId: input.stripeCustomerId } : {}),
    ...(input.stripePaymentIntentId
      ? { stripePaymentIntentId: input.stripePaymentIntentId }
      : {}),
    ...(input.stripePriceId ? { stripePriceId: input.stripePriceId } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(input.status === 'PAID' ? { paidAt: existing?.paidAt ?? now } : {}),
    ...(input.status === 'REFUNDED' ? { refundedAt: now } : {}),
  };

  await client.send(new PutCommand({ TableName: PAYMENTS_TABLE, Item: payment }));
  return payment;
}

/**
 * Moves one payment to another status, for an event that names the session but
 * carries nothing else — an expiry, or a checkout that Stripe abandoned.
 *
 * A no-op when there is no such row: a session nobody in this product created
 * (somebody's Stripe test event, a checkout started from the dashboard) is not a
 * payment, and inventing a row for it would be inventing a sale.
 */
export async function setPaymentStatus(
  paymentId: string,
  status: PaymentStatus,
  at: number = Date.now(),
): Promise<void> {
  try {
    await client.send(
      new UpdateCommand({
        TableName: PAYMENTS_TABLE,
        Key: { paymentId },
        UpdateExpression: 'SET #status = :status, updatedAt = :at',
        ConditionExpression: 'attribute_exists(paymentId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status, ':at': at },
      }),
    );
  } catch (err) {
    // The condition failing means the row is not there, which is an answer
    // rather than an error — see above. Anything else is a real failure.
    if (!isConditionalCheckFailed(err)) throw err;
  }
}
