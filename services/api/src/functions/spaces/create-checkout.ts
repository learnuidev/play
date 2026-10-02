import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { AuthUser } from '../../lib/auth';
import { requireUser } from '../../lib/auth';
import { env } from '../../lib/config';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { existingCustomerIdFor } from '../../lib/payment-methods';
import { recordPayment } from '../../lib/payments';
import { getSpaceMember } from '../../lib/space-members';
import { getSpace, setSpaceStripePrice } from '../../lib/spaces';
import { createPaymentIntent, createPrice, findPrice, productTaxCode, publishableKey } from '../../lib/stripe';

/**
 * Opening the marketplace's own checkout for a course.
 *
 * This is the route the checkout page calls when it opens, and it is the only
 * place in this service that *creates* a payment: it resolves the course's price,
 * opens a Stripe payment intent for it, writes the attempt down, and answers with
 * the two things a card form cannot be drawn without — the intent's client secret,
 * and the publishable key Stripe.js is loaded with. What it deliberately does not
 * do is enrol anybody: an intent existing is not money arriving. The webhook does
 * that, when Stripe says so.
 *
 * ## Why an intent, and not a redirect to Stripe's page
 *
 * It used to answer with a URL: the buyer left this product for Stripe's hosted
 * page, which drew the card fields, the tax line and the receipt. That is a
 * defensible thing to buy, and what it costs is the one screen where somebody
 * decides to trust a course with their card number — drawn in Stripe's default
 * look rather than the seller's. So the form is drawn here instead, with Stripe
 * Elements, and **the number still never reaches this app**: an Element is an
 * iframe Stripe fills in, which is what keeps this page out of PCI scope. What
 * changed is only who chooses the fields around it.
 *
 * `lib/stripe`'s `createPaymentIntent` says what an intent does not carry that a
 * session did — line items, and the tax computed from them — because that is a
 * decision about money rather than a detail of this route.
 *
 * ## Why the price is still found rather than created every time
 *
 * `Space.stripePriceId` caches the Stripe price a course is sold at, so the
 * dashboard shows one line per course rather than one per attempted purchase. The
 * cache is checked against the amount rather than trusted: an author who changes
 * a price leaves the cached price stale, and the check is what makes that produce
 * a *new* price at the new amount instead of a record that disagrees with what
 * the course costs. The stale price is left active in Stripe — a payment already
 * taken points at it, and a price is not something to delete out from under a
 * receipt.
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
    // is the answer to a checkout that was somehow opened on one.
    throw new HttpError(400, 'This course is free — register for it instead of paying.');
  }

  const currency = space.currency ?? 'usd';

  // Already in it: charging somebody for what they have is the one mistake here
  // that costs the product money rather than the learner, so it is checked
  // before an intent exists. An invitation counts — the membership is the
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
    taxCode: env.stripeProductTaxCode,
    cachedPriceId: space.stripePriceId,
  });

  const customerId = await customerForCheckout(user);

  const [intent, key] = await Promise.all([
    createPaymentIntent({
      amountCents: priceCents,
      currency,
      // What the dashboard and the receipt call this charge, and the only place
      // the course's name travels with the money: an intent has no line item to
      // name it.
      description: space.title,
      ...(customerId ? { customerId } : {}),
      ...(user.email ? { receiptEmail: user.email } : {}),
      metadata: {
        spaceId,
        userId: user.userId,
        organizationId: space.organizationId,
        // Which of the course's prices this sale is of. The intent carries an
        // amount rather than a price, so this is what puts the price on the
        // payment row without a second read of Stripe after the fact.
        priceId: price.id,
      },
    }),
    publishableKey(),
  ]);

  if (!intent.client_secret) {
    // An intent with no client secret cannot be confirmed by anything, and
    // answering with one would be a form that renders and then does nothing.
    throw new Error(`Stripe created payment intent ${intent.id} with no client secret`);
  }

  // Where Stripe sends the browser when a payment needs a page of its own — a
  // bank's verification step, or a wallet that leaves the site. The marketplace,
  // because that is where the course being paid for lives: the studio is where
  // the course was *written*, and a learner has no reason to be sent there. The
  // `paid` parameter is what lets the page say what it is waiting for rather than
  // looking like a button that did nothing.
  const courseUrl = `${env.marketplaceBaseUrl}/courses/${encodeURIComponent(spaceId)}`;

  // The attempt, written down before the form is even drawn. PENDING, because
  // that is what it is: the webhook is what turns it into PAID, and a checkout
  // nobody completes is a row that says "they tried" rather than nothing at all.
  // Keyed by the intent, so the webhook moves this row rather than adding a
  // second one — and the intent's id is also the row's `stripePaymentIntentId`,
  // which is what lets an event naming only the intent (a failure, a refund)
  // find it.
  await recordPayment({
    paymentId: intent.id,
    spaceId,
    organizationId: space.organizationId,
    userId: user.userId,
    status: 'PENDING',
    amountCents: priceCents,
    currency,
    ...(user.email ? { email: user.email } : {}),
    ...(customerId ? { stripeCustomerId: customerId } : {}),
    stripePaymentIntentId: intent.id,
    stripePriceId: price.id,
  });

  return ok({
    paymentId: intent.id,
    clientSecret: intent.client_secret,
    publishableKey: key,
    returnUrl: `${courseUrl}?paid=1`,
    amountCents: priceCents,
    currency,
  });
}

/**
 * The Stripe price this course is sold at right now.
 *
 * The cached id is used only when Stripe still has that price, it is active, it
 * is for exactly this amount and currency, and **its product carries this
 * deployment's tax code**. Anything else is a new price — and the write-back is
 * conditional on the course's price not having changed while this was in flight,
 * so two checkouts racing after an author edits the amount do not leave the
 * course pointing at whichever finished last.
 *
 * The amount and the currency are what the *charge* is built from, because that
 * is what an intent takes; the price itself is the record of what the course
 * sells for — one product per course in the dashboard, at a price, with the
 * classification the deployment gave it. Both halves can go stale, and neither is
 * checked on trust: an author edits the amount, or the deployment's tax
 * classification is changed in `infra/src/generated/service.ts`, and either one
 * is a reason to make the course's record again rather than keep selling under a
 * product nobody chose.
 */
async function priceForCourse(input: {
  spaceId: string;
  title: string;
  priceCents: number;
  currency: string;
  taxCode: string;
  cachedPriceId?: string;
}): Promise<{ id: string }> {
  if (input.cachedPriceId) {
    const cached = await findPrice(input.cachedPriceId);
    if (
      cached?.active &&
      cached.unit_amount === input.priceCents &&
      cached.currency === input.currency &&
      // Read through the expansion `findPrice` asks for: whether this is the
      // deployment's classification is a fact about the *product*, and a price
      // fetched without it would answer "no tax code" for every price ever made.
      productTaxCode(cached) === input.taxCode
    ) {
      return { id: cached.id };
    }
  }

  const created = await createPrice({
    title: input.title,
    amountCents: input.priceCents,
    currency: input.currency,
    taxCode: input.taxCode,
  });

  await setSpaceStripePrice(input.spaceId, created.id, {
    priceCents: input.priceCents,
    currency: input.currency,
  });

  return { id: created.id };
}

/**
 * The customer this purchase should land on, when the buyer has one.
 *
 * **Found, never created — and that is not the same rule this route followed
 * when it redirected.** It used to run once, for somebody who had already
 * decided to pay; it now runs when the checkout *page opens*, so a route that
 * created a customer would leave one behind in Stripe for every abandoned
 * checkout, which is the thing `billingContextFor`'s own comment calls out as the
 * reason a read must not make one.
 *
 * What is lost is small and worth naming: somebody who has never bought anything
 * and has never saved a card pays without a customer in Stripe, so their first
 * purchase is not gathered under one in the dashboard. Their receipt still goes
 * to their address, and the day they save a card `billingContextFor` makes the
 * customer every later purchase and card hangs off.
 *
 * A failure is logged and swallowed for the reason the wallet lookup always
 * swallows one: **resolving this must never cost somebody a purchase**. What is
 * lost when it fails is that the form does not offer the cards they saved
 * earlier; the payment itself is unaffected, because an intent does not need a
 * customer to be confirmed.
 */
async function customerForCheckout(user: AuthUser): Promise<string | null> {
  try {
    return (await existingCustomerIdFor(user))?.customerId ?? null;
  } catch (error) {
    console.error(`Could not resolve a Stripe customer for ${user.userId}`, error);
    return null;
  }
}

export const handler = handle(main);
