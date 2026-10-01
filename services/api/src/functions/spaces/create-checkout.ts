import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { env } from '../../lib/config';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { recordPayment } from '../../lib/payments';
import { getSpaceMember } from '../../lib/space-members';
import { getSpace, setSpaceStripePrice } from '../../lib/spaces';
import { createCheckoutSession, createPrice, findPrice } from '../../lib/stripe';

/**
 * Sending a learner to Stripe to pay for a course.
 *
 * This is the route the marketplace's pay button calls, and it is the only place
 * in this service that *creates* a payment: it resolves the course's price in
 * Stripe, opens a hosted checkout session for it, writes the attempt down, and
 * answers with the URL the browser is sent to. What it deliberately does not do
 * is enrol anybody — a session being created is not money arriving. The webhook
 * does that, when Stripe says so.
 *
 * ## Why the price is found rather than created every time
 *
 * `Space.stripePriceId` caches the Stripe price a course is sold at, so the
 * dashboard shows one line per course rather than one per attempted purchase. The
 * cache is checked against the amount rather than trusted: an author who changes
 * a price leaves the cached price stale, and the check is what makes that produce
 * a *new* price at the new amount instead of charging the old one. The stale
 * price is left active in Stripe — a payment already taken points at it, and a
 * price is not something to delete out from under a receipt.
 *
 * ## Who may ask
 *
 * Anybody signed in, for a course that is listed and has a price. Signing in is
 * the whole of the check, exactly as it is for registering: a listed course is
 * one its author has offered to anyone, and the only thing this route needs to
 * know about the caller is who to record as the buyer.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await getSpace(spaceId);
  // Unlisted is 404 rather than 403, for the reason `enroll` gives: a stranger
  // must not learn which private course ids exist by trying to buy one.
  if (!space || !space.listed) throw new HttpError(404, 'Course not found');

  const priceCents = space.priceCents ?? 0;
  if (priceCents <= 0) {
    // Not an error anybody should see from a page that knows what a course
    // costs: the marketplace draws a register button for a free course, and this
    // is the answer to a pay button that was somehow pressed on one.
    throw new HttpError(400, 'This course is free — register for it instead of paying.');
  }

  const currency = space.currency ?? 'usd';

  // Already in it: charging somebody for what they have is the one mistake here
  // that costs the product money rather than the learner, so it is checked
  // before a session exists. An invitation counts — the membership is the
  // permission, however it was given.
  const existing = await getSpaceMember(spaceId, user.userId);
  if (existing?.status === 'ACTIVE') {
    throw new HttpError(409, 'You are already registered for this course.');
  }

  const price = await priceForCourse({
    spaceId,
    title: space.title,
    priceCents,
    currency,
    cachedPriceId: space.stripePriceId,
  });

  // Where Stripe sends the browser afterwards. Both are the marketplace, because
  // that is where the course page being paid for lives — the studio is where the
  // course was *written*, and a learner has no reason to be sent there. The
  // `paid` parameter is what lets the page say what it is waiting for rather
  // than looking like a button that did nothing.
  const courseUrl = `${env.marketplaceBaseUrl}/courses/${encodeURIComponent(spaceId)}`;

  const session = await createCheckoutSession({
    priceId: price.id,
    successUrl: `${courseUrl}?paid=1`,
    cancelUrl: courseUrl,
    ...(user.email ? { customerEmail: user.email } : {}),
    clientReferenceId: user.userId,
    metadata: {
      spaceId,
      userId: user.userId,
      organizationId: space.organizationId,
      // Which of the course's prices was sold. Stripe records the price on the
      // session anyway, and this is what puts it on the payment row without a
      // second read of Stripe after the fact.
      priceId: price.id,
    },
  });

  if (!session.url) {
    // A session with no URL cannot be paid, and answering with one would be a
    // redirect to nowhere.
    throw new Error(`Stripe created session ${session.id} with no checkout URL`);
  }

  // The attempt, written down before anybody is sent anywhere. PENDING, because
  // that is what it is: the webhook is what turns it into PAID, and a session
  // nobody completes is a row that says "they tried" rather than nothing at all.
  // Keyed by the session, so the webhook updates this row rather than adding a
  // second one.
  await recordPayment({
    paymentId: session.id,
    spaceId,
    organizationId: space.organizationId,
    userId: user.userId,
    status: 'PENDING',
    amountCents: priceCents,
    currency,
    ...(user.email ? { email: user.email } : {}),
    ...(session.payment_intent ? { stripePaymentIntentId: session.payment_intent } : {}),
    stripePriceId: price.id,
  });

  return ok({ url: session.url, paymentId: session.id, amountCents: priceCents, currency });
}

/**
 * The Stripe price this course is sold at right now.
 *
 * The cached id is used only when Stripe still has that price, it is active, and
 * it is for exactly this amount and currency. Anything else is a new price — and
 * the write-back is conditional on the course's price not having changed while
 * this was in flight, so two checkouts racing after an author edits the amount do
 * not leave the course pointing at whichever finished last.
 */
async function priceForCourse(input: {
  spaceId: string;
  title: string;
  priceCents: number;
  currency: string;
  cachedPriceId?: string;
}): Promise<{ id: string }> {
  if (input.cachedPriceId) {
    const cached = await findPrice(input.cachedPriceId);
    if (
      cached?.active &&
      cached.unit_amount === input.priceCents &&
      cached.currency === input.currency
    ) {
      return { id: cached.id };
    }
  }

  const created = await createPrice({
    title: input.title,
    amountCents: input.priceCents,
    currency: input.currency,
  });

  await setSpaceStripePrice(input.spaceId, created.id, {
    priceCents: input.priceCents,
    currency: input.currency,
  });

  return { id: created.id };
}

export const handler = handle(main);
