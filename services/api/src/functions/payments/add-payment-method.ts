import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { env } from '../../lib/config';
import { handle, ok } from '../../lib/http';
import { stripeCustomerIdFor } from '../../lib/payment-methods';
import { createSetupSession } from '../../lib/stripe';

/**
 * Sending a learner to Stripe to save a card.
 *
 * The mirror of the checkout route and deliberately the same shape: this service
 * does not take card details, so the form is Stripe's hosted page and what comes
 * back is a URL to redirect to. The difference is what has been asked for —
 * `mode=setup` has no line item and no amount, so nothing can be charged by the
 * page somebody lands on, and the event Stripe sends afterwards names a setup
 * intent rather than a payment.
 *
 * Nothing is written here. The row appears when the webhook hears that a card was
 * entered, because "they opened the form" and "they saved a card" are different
 * facts — the same distinction the checkout route draws between a session being
 * created and money arriving.
 *
 * The customer is resolved first, and only then is a session opened for it: a
 * card is saved *against a customer*, and the one it is saved against has to be
 * the same one this person's purchases were made under. `stripeCustomerIdFor`
 * finds it on a card they already have, on a payment they have already made, or
 * creates it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const customerId = await stripeCustomerIdFor(user);

  // Where Stripe sends the browser back to: the screen the card is added from,
  // which is the marketplace's, and the flag is what tells that page to wait for
  // the webhook rather than drawing the list it had a moment ago.
  const cardsUrl = `${env.marketplaceBaseUrl}/account/payment-cards`;

  const session = await createSetupSession({
    customerId,
    successUrl: `${cardsUrl}?added=1`,
    cancelUrl: cardsUrl,
    metadata: { userId: user.userId },
  });

  if (!session.url) {
    // A session with no URL cannot be opened, and answering with one would be a
    // redirect to nowhere.
    throw new Error(`Stripe created setup session ${session.id} with no checkout URL`);
  }

  return ok({ url: session.url, setupId: session.id });
}

export const handler = handle(main);
