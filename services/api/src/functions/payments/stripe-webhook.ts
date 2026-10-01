import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { isConditionalCheckFailed } from '../../lib/dynamodb';
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
 * A purchase here is a **checkout session**, and the row it writes is keyed by
 * that session: what was paid, for which course, by whom. Then it does the one
 * thing the money is for — it enrols the buyer, by calling the same
 * `enrollInSpace` the marketplace's own register button calls, so a learner who
 * pays is in the course by exactly the route a learner who registers is. Paying
 * twice is not an error: the membership write is conditional, and a second
 * payment for a course somebody is already in leaves the first membership alone.
 *
 * ## Idempotency, which is the whole difficulty of a webhook
 *
 * Stripe delivers at least once and retries anything that is not a 2xx, so every
 * handler here has to be safe to run twice. Three things make it so: the row's
 * key is the session id, so a re-delivery updates one row rather than adding a
 * second sale; `enrollInSpace` is conditional on the membership not existing; and
 * the events that name only a payment intent — a refund, a failure — are looked
 * up through the index the table declares for that, tolerating the case where the
 * payment is not ours to update.
 *
 * ## What it deliberately does not do
 *
 * **A refund does not take the course away.** The money going back is recorded —
 * the row's status, and when — and the enrolment is left where it is, because
 * removing somebody from a course they may be halfway through is a decision about
 * the product rather than a data fix, and one a webhook is the worst possible
 * place to make. An author who wants access revoked revokes it; what they cannot
 * get back is the record that it was paid for and refunded, which is here.
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
}

interface Charge {
  amount: number;
  amount_refunded: number;
  payment_intent?: string | null;
}

interface PaymentIntent {
  id: string;
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
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return recordCheckout(event.data.object as unknown as CheckoutSession);

    case 'checkout.session.expired':
      return expireCheckout(event.data.object as unknown as CheckoutSession);

    case 'payment_intent.payment_failed':
      return failIntent(event.data.object as unknown as PaymentIntent);

    case 'charge.refunded':
      return refundCharge(event.data.object as unknown as Charge);

    default:
      // Subscribed to nothing else, but an endpoint that answers a 400 to an
      // event it does not know would make Stripe retry it for three days.
      return `${event.type} is not one of the events this deployment handles`;
  }
}

/**
 * A checkout that completed — the event a purchase is.
 *
 * `checkout.session.completed` fires when the *session* completes, which for a
 * delayed payment method is before the money has actually arrived: the session
 * says `payment_status: unpaid` and `checkout.session.async_payment_succeeded`
 * follows later, when it clears. So a completed session that is not paid is
 * recorded — the attempt is real and worth having — and **not** enrolled: giving
 * a course away on a promise is the one mistake here that costs money rather than
 * a support message.
 */
async function recordCheckout(session: CheckoutSession): Promise<string> {
  const spaceId = session.metadata?.spaceId;
  const userId = session.metadata?.userId;

  if (!spaceId || !userId) {
    // A session this product did not create — a test event, or a checkout made
    // from the Stripe dashboard. There is no row to write without inventing one,
    // and a signed request is still not a purchase.
    return 'the session carries no spaceId and userId metadata, so there is nothing to record';
  }

  const paid = session.payment_status === 'paid';
  const space = await getSpace(spaceId);
  if (!space) return `no course ${spaceId} to record a payment against`;

  const email = session.customer_details?.email ?? undefined;
  const payment = await recordPayment({
    paymentId: session.id,
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

/** A checkout nobody completed. Recorded, so "they tried" is not invisible. */
async function expireCheckout(session: CheckoutSession): Promise<string> {
  await setPaymentStatus(session.id, 'EXPIRED');
  return `marked ${session.id} expired`;
}

/**
 * A payment that did not go through.
 *
 * Looked up by the intent, because that is all the event names — and skipped when
 * there is no row for it, which is the normal state for an intent that failed
 * before any session of ours was involved.
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
