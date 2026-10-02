import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { Payment, PaymentStatus } from '../types';
import { env } from './config';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';

export const PAYMENTS_TABLE = env.paymentsTableName;

/**
 * The one index this module reads.
 *
 * Every event about a payment that has already happened names the **payment
 * intent** — a failure, a cancellation, a refund — and the row those events are
 * about is keyed by whatever the purchase was opened as. For a payment made in
 * the marketplace's own checkout the two are the same string; for one made on
 * Stripe's hosted page the row is keyed by the *session* and the intent is only
 * on it, which is exactly the case this index is for. Without it, those events
 * would be a scan of every payment in the table, or a row that never gets
 * updated.
 *
 * The table declares two more — what one person has bought, and who has bought
 * one course — and neither is read here yet: they are what the marketplace's own
 * screens will query, and they are declared with the table because an index added
 * later is an `UpdateTable` against a table that by then has rows in it.
 */
const PAYMENT_INTENT_INDEX = 'PaymentIntentIndex';

/**
 * What one person has bought, in the order they bought it.
 *
 * The index the table declared for exactly this — "what one person has bought"
 * — and the read behind three screens: the billing history, the course page that
 * has to know whether this is a purchase rather than a registration, and the
 * leave route that refuses to undo one. All three ask about the caller's own
 * payments, so all three are one query by their own `sub`.
 */
const USER_CREATED_INDEX = 'UserCreatedIndex';

/**
 * How long a learner has to change their mind about a purchase.
 *
 * Thirty days from the payment, and the number lives here rather than in the
 * screens that print it: the marketplace shows the deadline, the route enforces
 * it, and a second copy would be the one that drifts. It is mirrored as
 * `REFUND_WINDOW_DAYS` in `@play/types` for the copy that says "30 days" in a
 * sentence — the same arrangement the profile's length limits have.
 */
export const REFUND_WINDOW_DAYS = 30;

/** Thirty days in milliseconds, spelled once. */
const REFUND_WINDOW_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** When the money was taken: the payment's own `paidAt`, or when it was written. */
export function paidAtOf(payment: Payment): number {
  return payment.paidAt ?? payment.createdAt;
}

/**
 * The last moment a refund may be asked for, or undefined when there is none.
 *
 * A payment that is not `PAID` has no window — an attempt that expired and one
 * already refunded are both closed, and answering with a date for either would
 * be offering a countdown to nothing. So this answers "when the window closes"
 * only for the payments the window is still open on.
 */
export function refundDeadlineOf(payment: Payment): number | undefined {
  if (payment.status !== 'PAID') return undefined;
  return paidAtOf(payment) + REFUND_WINDOW_MS;
}

/**
 * Whether Stripe is the one who would have to give the money back.
 *
 * Without a payment intent there is nothing to refund: the row exists because a
 * checkout was opened, not because a charge was made. Every row the webhook
 * writes as PAID has one, so this is the guard for the rows that predate the
 * field rather than a state a learner can reach.
 */
export function isRefundable(payment: Payment, now: number = Date.now()): boolean {
  if (payment.status !== 'PAID' || !payment.stripePaymentIntentId) return false;
  return now < paidAtOf(payment) + REFUND_WINDOW_MS;
}

/**
 * Everything this person has attempted to buy, newest first.
 *
 * Paged to the end rather than to a page, and deliberately: a person's purchases
 * are counted in tens, and the two callers that are not the billing history —
 * "did they buy this course", "is this a purchase" — cannot answer from a page.
 * The ceiling is a stop for a pathological account rather than a page size.
 *
 * **Everything includes the attempts**, which is what those two questions need:
 * an intent opened on a checkout page is a payment that exists, and whether it
 * is `PAID` is the answer either way. A caller drawing a list of *receipts* is
 * the one that leaves them out — see `functions/payments/list-payments.ts`.
 */
const MY_PAYMENTS_CEILING = 500;

export async function listPaymentsForUser(userId: string): Promise<Payment[]> {
  const payments: Payment[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: PAYMENTS_TABLE,
        IndexName: USER_CREATED_INDEX,
        KeyConditionExpression: '#userId = :userId',
        ExpressionAttributeNames: { '#userId': 'userId' },
        ExpressionAttributeValues: { ':userId': userId },
        // Newest first: the index is ordered by `createdAt`, and a receipt list
        // is read from the top.
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    payments.push(...((res.Items ?? []) as Payment[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey && payments.length < MY_PAYMENTS_CEILING);

  return payments;
}

/**
 * Whether this person bought this course.
 *
 * "Bought" is `PAID` and nothing else: a refunded payment is money that came
 * back, and a pending one is an attempt that has not bought anything. It is read
 * off the same list the billing history draws, so the course page and the
 * receipt cannot disagree about whether there was a purchase.
 */
export async function findPaidPayment(
  userId: string,
  spaceId: string,
): Promise<Payment | undefined> {
  const payments = await listPaymentsForUser(userId);
  return payments.find((payment) => payment.spaceId === spaceId && payment.status === 'PAID');
}

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
 * Writes what Stripe said about one payment.
 *
 * A `Put` rather than an update, and that is the idempotency: the row's key **is**
 * the payment Stripe named — the intent, or the session for a purchase that
 * started on the hosted page — so Stripe re-delivering the same event, which it
 * does on any response that is not a 2xx, writes the same row again rather than
 * adding a second sale. `createdAt` is preserved across that, because the row
 * appearing is not the same event as the purchase happening, and a receipt should
 * not change its date because a webhook was retried.
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
        // `refundedAt` travels with `REFUNDED` rather than being a second write
        // at each call site: the status and the moment it happened are one fact,
        // and a caller that remembered one and forgot the other would leave a
        // refunded payment whose receipt says nothing about when.
        UpdateExpression:
          'SET #status = :status, updatedAt = :at' +
          (status === 'REFUNDED' ? ', refundedAt = :at' : ''),
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
