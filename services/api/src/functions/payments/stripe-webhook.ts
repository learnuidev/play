import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { isConditionalCheckFailed } from '../../lib/dynamodb';
import { recordSetupIntent } from '../../lib/payment-methods';
import {
  findPaymentByIntent,
  recordPayment,
  setPaymentStatus,
} from '../../lib/payments';
import { AlreadyEnrolledError, enrollInSpace } from '../../lib/space-members';
import { getSpace } from '../../lib/spaces';
import { stripeCredentials, verifyStripeSignature } from '../../lib/stripe';

/**
 * What Stripe tells this deployment happened.
 *
 * The endpoint is a Lambda function URL published by `PlayPaymentStack`, and it
 * is public because the caller is Stripe: it has no Cognito token and no AWS
 * identity. What authenticates the request is therefore the `Stripe-Signature`
 * header, checked against this environment's webhook signing secret **before the
 * body is parsed** — the signature covers the raw bytes, so the bytes are what is
 * verified and the JSON is read afterwards.
 *
 * ## What it does with an event
 *
 * A purchase here is a **payment intent** — the marketplace draws its own
 * checkout page with Elements — and the row it writes is keyed by that intent:
 * what was paid, for which course, by whom. Then it does the one thing the money
 * is for — it enrols the buyer, by calling the same `enrollInSpace` the
 * marketplace's own register button calls, so a learner who pays is in the course
 * by exactly the route a learner who registers is. Paying twice is not an error:
 * the membership write is conditional, and a second payment for a course somebody
 * is already in leaves the first membership alone.
 *
 * **A checkout session is still handled, and it is a straggler.** Every purchase
 * used to be one: the marketplace sent the browser to Stripe's hosted page and
 * this endpoint heard `checkout.session.completed`. Nothing creates one any more,
 * but a page somebody still has open — or a session opened minutes before a
 * deploy — completes and pays exactly as it did, and a purchase nobody records is
 * a buyer with no course. So the session path stays, and it writes the *same row*
 * as the intent path does (see the lookup in `recordCheckout`: one sale, one row,
 * whichever id Stripe names first).
 *
 * **A session in `mode=setup` is a card being saved.** No line item, nothing
 * charged, completing with a setup intent — and it is branched on `mode` before
 * anything else is read. That is a straggler too: the marketplace draws its own
 * card field with Elements and records the result through
 * `POST /me/payment-methods`. It writes the same row through the same function,
 * so the two paths cannot disagree about a card.
 *
 * ## Idempotency, which is the whole difficulty of a webhook
 *
 * Stripe delivers at least once and retries anything that is not a 2xx, so every
 * handler here has to be safe to run twice. Three things make it so: the row's
 * key is the intent (or the session) the event names, so a re-delivery updates
 * one row rather than adding a second sale; `enrollInSpace` is conditional on the
 * membership not existing; and every event that names a payment without naming a
 * row — a success, a refund, a failure — is looked up through the index the table
 * declares for the intent, tolerating the case where the payment is not ours to
 * update.
 *
 * ## What it deliberately does not do
 *
 * **A refund heard here does not take the course away.** The money going back is
 * recorded — the row's status, and when — and the enrolment is left where it is,
 * because removing somebody from a course they may be halfway through is a
 * decision about the product rather than a data fix, and one a webhook is the
 * worst possible place to make. A refund somebody *asked for* is a different
 * event with a person behind it: `functions/payments/refund-payment.ts` is where
 * that decision is made, and it revokes the access it just paid back. What
 * arrives here is the confirmation that the charge was refunded, whoever
 * started it, and the row ends up `REFUNDED` either way.
 */

type WebhookResult = { statusCode: number; body: string };

const answer = (statusCode: number, message: string): WebhookResult => ({
  statusCode,
  body: JSON.stringify({ received: message }),
});

/**
 * The event, as much of it as this handler reads.
 *
 * Typed by hand rather than imported from `stripe`: the fields below are the
 * contract this code has with Stripe's API, and an interface that says so is
 * clearer than a package whose types describe a hundred and fifty event shapes
 * for the six that are handled.
 */
interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

interface CheckoutSession {
  id: string;
  amount_total: number | null;
  currency: string | null;
  payment_status?: string;
  customer?: string | null;
  payment_intent?: string | null;
  customer_details?: { email?: string | null } | null;
  metadata?: Record<string, string> | null;
  /**
   * `payment` for a course being bought, `setup` for a card being saved.
   *
   * The one field that tells the two kinds of checkout session apart, and both
   * arrive as the same event: `mode` is therefore read *before* the metadata,
   * because a setup session has a buyer and no course, and the purchase path
   * would tell Stripe it had nothing to record.
   */
  mode?: string;
  /** The intent a setup session completes with. Only set in `setup` mode. */
  setup_intent?: string | null;
}

interface Charge {
  amount: number;
  amount_refunded: number;
  payment_intent?: string | null;
}

/**
 * A payment intent, which is what a purchase made on the marketplace's own
 * checkout arrives as.
 *
 * The amount and the currency travel with the event, so nothing here reads the
 * course's price again: what was charged is what Stripe says was charged. The
 * metadata is what the checkout route put on it — without it this event would
 * name a payment with no course and no buyer.
 */
interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  customer?: string | null;
  receipt_email?: string | null;
  metadata?: Record<string, string> | null;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<WebhookResult> => {
  const payload = rawBody(event);
  if (payload === null) {
    return answer(400, 'this endpoint expects the body Stripe sends');
  }

  const header =
    event.headers?.['stripe-signature'] ?? event.headers?.['Stripe-Signature'] ?? undefined;

  let credentials: Awaited<ReturnType<typeof stripeCredentials>>;
  try {
    credentials = await stripeCredentials();
  } catch (error) {
    // A deployment with no credentials configured cannot verify anything, and
    // refusing is the only safe answer: the alternative is an endpoint that
    // processes whatever it is sent. 500 rather than 400, because this is ours to
    // fix and Stripe's retries are the reminder.
    console.error('Stripe credentials could not be read', error);
    return answer(500, 'this deployment has no Stripe credentials configured');
  }

  const verdict = verifyStripeSignature({
    payload,
    header,
    signingSecret: credentials.webhookSigningSecret,
  });
  if (!verdict.ok) {
    // Not a Stripe request, or not one signed with this endpoint's secret.
    // Logged with the reason and answered with a 400: there is nothing to retry,
    // and a person reading the log needs to know which of the two it was.
    console.warn(`Refused a webhook: ${verdict.reason}`);
    return answer(400, `signature not verified — ${verdict.reason}`);
  }

  let parsed: StripeEvent;
  try {
    parsed = JSON.parse(payload) as StripeEvent;
  } catch {
    return answer(400, 'the signed body was not JSON');
  }

  try {
    const note = await apply(parsed);
    return answer(200, note);
  } catch (error) {
    // Ours, and worth retrying: Stripe will send it again, which is exactly what
    // a half-written payment needs.
    console.error(`Failed to handle ${parsed.type} (${parsed.id})`, error);
    return answer(500, `${parsed.type} could not be recorded`);
  }
};

/**
 * The event's body as the exact bytes Stripe signed.
 *
 * Function URLs hand a text body over as a string, and only base64-encode it when
 * it is binary — Stripe sends JSON, so this is nearly always the string as it
 * arrived. The decode is here anyway because a body that arrived the other way
 * would otherwise fail signature verification with no way to tell why.
 */
function rawBody(event: APIGatewayProxyEventV2): string | null {
  if (!event.body) return null;
  if (!event.isBase64Encoded) return event.body;
  return Buffer.from(event.body, 'base64').toString('utf8');
}

/**
 * One event, applied.
 *
 * Returns a sentence for the response body, which is what a person sees in
 * Stripe's dashboard under the delivery — the cheapest possible place to explain
 * why an event was ignored.
 */
async function apply(event: StripeEvent): Promise<string> {
  switch (event.type) {
    case 'payment_intent.succeeded':
      return recordIntent(event.data.object as unknown as PaymentIntent);
    case 'payment_intent.payment_failed':
      return failIntent(event.data.object as unknown as PaymentIntent);
    case 'payment_intent.canceled':
      return expireIntent(event.data.object as unknown as PaymentIntent);

    // The hosted page this deployment used to send buyers to. Nothing creates a
    // session any more, and these are the stragglers: a page somebody still has
    // open, which pays exactly as it always did.
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return recordCheckout(event.data.object as unknown as CheckoutSession);
    case 'checkout.session.expired':
      return expireCheckout(event.data.object as unknown as CheckoutSession);

    case 'charge.refunded':
      return refundCharge(event.data.object as unknown as Charge);

    default:
      // Subscribed to nothing else, but an endpoint that answers a 400 to an
      // event it does not know would make Stripe retry it for three days.
      return `${event.type} is not one of the events this deployment handles`;
  }
}

/**
 * A payment that went through — the event a purchase on the marketplace's own
 * checkout arrives as.
 *
 * `payment_intent.succeeded` means the money was taken, and that is the whole
 * difference from the session path below: a session can complete with
 * `payment_status: unpaid` and be paid later by a method that clears
 * asynchronously, which is why `recordCheckout` has to look before it enrols. An
 * intent that succeeded has succeeded, so this always writes PAID and always
 * enrols.
 *
 * **The row is usually already there** — `create-checkout` writes the attempt as
 * PENDING when the checkout page opens, keyed by this intent — and it is looked
 * up rather than assumed for the reason the session path also looks: the row it
 * has to move may be keyed by something else. A payment that started on the
 * hosted page has a row keyed by its session, and the intent it paid carries the
 * same metadata, so writing a second row keyed by the intent would be two
 * receipts for one course.
 */
async function recordIntent(intent: PaymentIntent): Promise<string> {
  const existing = await findPaymentByIntent(intent.id);

  // The metadata first, because it is what the route wrote for *this* attempt;
  // the existing row's own fields are the fallback for an intent whose metadata
  // is missing — a payment made from Stripe's dashboard against a course, say,
  // which is still a payment of ours if the row is.
  const spaceId = intent.metadata?.spaceId ?? existing?.spaceId;
  const userId = intent.metadata?.userId ?? existing?.userId;

  if (!spaceId || !userId) {
    // Not ours to record: an intent this deployment did not create — a test
    // event, or a charge made from the dashboard. There is no row to write
    // without inventing one, and a signed request is still not a purchase.
    return 'the intent carries no spaceId and userId metadata, so there is nothing to record';
  }

  const space = await getSpace(spaceId);
  if (!space) return `no course ${spaceId} to record a payment against`;

  const email = existing?.email ?? intent.receipt_email ?? undefined;
  const payment = await recordPayment({
    paymentId: existing?.paymentId ?? intent.id,
    spaceId,
    organizationId: space.organizationId,
    userId,
    status: 'PAID',
    amountCents: intent.amount,
    currency: intent.currency,
    ...(email ? { email } : {}),
    ...(intent.customer ? { stripeCustomerId: intent.customer } : {}),
    stripePaymentIntentId: intent.id,
    ...(intent.metadata?.priceId ? { stripePriceId: intent.metadata.priceId } : {}),
  });

  const enrolled = await enrol(spaceId, space.organizationId, userId, email);
  return `recorded ${payment.paymentId} as paid; ${enrolled}`;
}

/**
 * A checkout that completed — the event a purchase *used* to be.
 *
 * `checkout.session.completed` fires when the *session* completes, which for a
 * delayed payment method is before the money has actually arrived: the session
 * says `payment_status: unpaid` and `checkout.session.async_payment_succeeded`
 * follows later, when it clears. So a completed session that is not paid is
 * recorded — the attempt is real and worth having — and **not** enrolled: giving
 * a course away on a promise is the one mistake here that costs money rather than
 * a support message.
 *
 * **The row is looked for by the payment intent first.** The same purchase
 * arrives twice now — once as the session that paid it, once as the intent
 * itself — and Stripe copies a session's metadata onto the intent, so both
 * events pass every check in this file and would write a row each: two receipts
 * for one course, and a refund button on both. Whichever handler runs second
 * finds the row the first one wrote and moves *that*, which is what makes the
 * order they arrive in irrelevant.
 */
async function recordCheckout(session: CheckoutSession): Promise<string> {
  // A **setup** session is a card being saved, not a course being bought, and it
  // arrives as this same event: the difference is `mode`, and it is read before
  // the metadata because the two sessions carry different metadata — a setup
  // session has a buyer and no course, so the purchase path below would report
  // that there was nothing to record.
  if (session.mode === 'setup') return recordSetup(session);

  const spaceId = session.metadata?.spaceId;
  const userId = session.metadata?.userId;

  if (!spaceId || !userId) {
    // A session this product did not create — a test event, or a checkout made
    // from the Stripe dashboard. There is no row to write without inventing one,
    // and a signed request is still not a purchase.
    return 'the session carries no spaceId and userId metadata, so there is nothing to record';
  }

  const known = session.payment_intent
    ? await findPaymentByIntent(session.payment_intent)
    : undefined;

  const paid = session.payment_status === 'paid';
  const space = await getSpace(spaceId);
  if (!space) return `no course ${spaceId} to record a payment against`;

  const email = session.customer_details?.email ?? known?.email ?? undefined;
  const payment = await recordPayment({
    paymentId: known?.paymentId ?? session.id,
    spaceId,
    organizationId: space.organizationId,
    userId,
    status: paid ? 'PAID' : 'PENDING',
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? 'usd',
    ...(email ? { email } : {}),
    ...(session.customer ? { stripeCustomerId: session.customer } : {}),
    ...(session.payment_intent ? { stripePaymentIntentId: session.payment_intent } : {}),
    ...(session.metadata?.priceId ? { stripePriceId: session.metadata.priceId } : {}),
  });

  if (!paid) {
    return `recorded ${payment.paymentId} as pending until the payment clears`;
  }

  const enrolled = await enrol(spaceId, space.organizationId, userId, email);
  return `recorded ${payment.paymentId} as paid; ${enrolled}`;
}

/**
 * A payment intent nobody confirmed, cancelled — by Stripe on whatever schedule
 * it cancels unconfirmed intents, or by somebody in the dashboard.
 *
 * This is `checkout.session.expired`'s counterpart, and it is what keeps an
 * abandoned checkout from sitting in somebody's billing history as PENDING for
 * good: the row the checkout page wrote moves to `EXPIRED`, which is the status
 * the marketplace already draws as "you tried and did not finish" rather than
 * "this failed".
 *
 * Found by the intent, so a cancellation of an intent this deployment never wrote
 * a row for — somebody else's, or a test event — says so instead of inventing
 * one.
 */
async function expireIntent(intent: PaymentIntent): Promise<string> {
  const payment = await findPaymentByIntent(intent.id);
  if (!payment) return `no payment of this deployment used ${intent.id}`;

  await setPaymentStatus(payment.paymentId, 'EXPIRED');
  return `marked ${payment.paymentId} expired`;
}

/**
 * A card somebody saved, which is the other half of `mode=setup`.
 *
 * The event names a setup intent and nothing else, and the two reads that turn
 * it into a card — the intent for the payment method, the method for its brand
 * and last four digits — are `recordSetupIntent`'s, because what is worth
 * testing there is the row and not Stripe's JSON.
 *
 * A session with no `userId` is not ours to record: the row exists only to be
 * shown back to the person who saved it, and there is nobody to show it to.
 * A method that is not a card, or an intent with no method yet, is reported
 * rather than stored — a row with no digits would be a card nobody recognizes.
 *
 * Re-delivery is the normal case here rather than the exception — the same
 * event arrives again on any response that is not a 2xx — and it writes the same
 * row again with the `createdAt` it already had. That is why this is a `Put`
 * on the card's own key rather than an append.
 */
async function recordSetup(session: CheckoutSession): Promise<string> {
  const userId = session.metadata?.userId;
  if (!userId) {
    return 'the setup session carries no userId metadata, so there is no account to save a card to';
  }
  if (!session.setup_intent) {
    return `setup session ${session.id} completed without a setup intent`;
  }

  const card = await recordSetupIntent({
    userId,
    setupIntentId: session.setup_intent,
  });

  return card
    ? `saved ${card.brand} ending ${card.last4} for ${userId}`
    : `setup session ${session.id} saved no card this service records`;
}

/**
 * Puts the buyer in the course.
 *
 * The same call the register button makes, so there is one definition of what
 * being in a course is — a payment is not a second kind of membership. Two
 * outcomes are not failures: the buyer already being enrolled, which is what a
 * re-delivered event finds, and the conditional write losing a race with the
 * buyer's own tab. Both are reported rather than thrown, because a 500 would ask
 * Stripe to send the event again for an outcome that is already correct.
 */
async function enrol(
  spaceId: string,
  organizationId: string,
  userId: string,
  email?: string,
): Promise<string> {
  try {
    await enrollInSpace({ spaceId, organizationId, userId, ...(email ? { email } : {}) });
    return 'the buyer is enrolled';
  } catch (error) {
    if (error instanceof AlreadyEnrolledError || isConditionalCheckFailed(error)) {
      return 'the buyer was already enrolled';
    }
    throw error;
  }
}

/**
 * A checkout nobody completed. Recorded, so "they tried" is not invisible.
 *
 * A **setup** session expiring is not recorded at all, and is not the same
 * thing: nobody abandoned a purchase, they closed a card form, and there is no
 * payment row for the session id to move. Saying so is the whole of what this
 * event means for a card that was never saved.
 */
async function expireCheckout(session: CheckoutSession): Promise<string> {
  if (session.mode === 'setup') {
    return `setup session ${session.id} expired before a card was saved`;
  }

  await setPaymentStatus(session.id, 'EXPIRED');
  return `marked ${session.id} expired`;
}

/**
 * A payment that did not go through. The card was declined, or the bank refused
 * it, and the row the checkout page wrote becomes `FAILED`.
 *
 * Looked up by the intent, because that is all the event names — and skipped when
 * there is no row for it, which is the normal state for an intent this
 * deployment never opened: somebody's test event, or a charge attempted from the
 * dashboard.
 */
async function failIntent(intent: PaymentIntent): Promise<string> {
  const payment = await findPaymentByIntent(intent.id);
  if (!payment) return `no payment of this deployment used ${intent.id}`;

  await setPaymentStatus(payment.paymentId, 'FAILED');
  return `marked ${payment.paymentId} failed`;
}

/**
 * Money going back.
 *
 * Only a **full** refund moves the row: Stripe raises `charge.refunded` for a
 * partial one too, and telling a course's author that a sale was refunded when a
 * fifth of it was is worse than saying nothing. A partial refund is logged and
 * left as `PAID`, which is what it still is.
 */
async function refundCharge(charge: Charge): Promise<string> {
  if (!charge.payment_intent) return 'the charge names no payment intent';

  if (charge.amount_refunded < charge.amount) {
    console.log(
      `Partial refund of ${charge.amount_refunded} of ${charge.amount} on ${charge.payment_intent}`,
    );
    return `partial refund of ${charge.amount_refunded}/${charge.amount} — the payment stays paid`;
  }

  const payment = await findPaymentByIntent(charge.payment_intent);
  if (!payment) return `no payment of this deployment used ${charge.payment_intent}`;

  await setPaymentStatus(payment.paymentId, 'REFUNDED');
  return `marked ${payment.paymentId} refunded; the enrolment is left alone`;
}
