import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import { listPaymentMethods, toSavedPaymentMethod } from '../../lib/payment-methods';

/**
 * The cards this person has saved.
 *
 * Under `/me`, with no id in the path, for the reason the profile is: the
 * caller's own token is the only id there is, so there is no authorization here
 * to get wrong and no way to ask for somebody else's cards.
 *
 * Read from this service's own table rather than from Stripe. What is stored is
 * what was saved *by this product*, which is what the screen is about — a
 * payment method created in Stripe's dashboard for the same customer is not
 * something a learner put here, and listing it would be showing them a card
 * they never added.
 *
 * The rows are mapped rather than answered with, so what crosses the wire is the
 * card as its owner recognizes it: the two ids on the row are the caller's own
 * `sub` and a Stripe customer reference, and neither is anything a screen has a
 * use for.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const rows = await listPaymentMethods(userId);

  return ok({ paymentMethods: rows.map(toSavedPaymentMethod) });
}

export const handler = handle(main);
