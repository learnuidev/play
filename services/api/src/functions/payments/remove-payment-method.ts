import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';
import { deletePaymentMethodRow, getPaymentMethodRow } from '../../lib/payment-methods';
import { detachPaymentMethod, StripeError } from '../../lib/stripe';

/**
 * Forgetting a saved card.
 *
 * **Stripe first, then the row**, so that a card this screen no longer shows has
 * genuinely stopped being usable: the row is only what a person sees, and
 * Stripe's own checkout page offers whatever the customer still holds. A failure
 * at Stripe therefore removes nothing and says so, which is the honest answer to
 * "remove this card" — it was not removed.
 *
 * The one exception is the card **Stripe no longer has** — somebody who deleted
 * it in the dashboard. That is not a failure but the thing that was asked for,
 * already done: detaching it again can only ever answer 404, so the 404 is
 * treated as done and the stale row goes. Any other refusal is still raised.
 *
 * The row is looked up **as the caller** before Stripe is told anything. The key
 * is the pair, so somebody else's card id is not found rather than found and
 * refused, and a card that is not there answers 404: "no such card" and "not
 * yours" are the same sentence on purpose, because telling them apart would say
 * which ids exist.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const paymentMethodId = pathParam(event, 'paymentMethodId');

  const existing = await getPaymentMethodRow(userId, paymentMethodId);
  if (!existing) throw new HttpError(404, 'That card is not saved on your account');

  try {
    await detachPaymentMethod(paymentMethodId);
  } catch (error) {
    if (!(error instanceof StripeError) || error.status !== 404) throw error;
    console.log(`Card ${paymentMethodId} was already gone from Stripe; forgetting the row`);
  }

  await deletePaymentMethodRow(userId, paymentMethodId);

  return noContent();
}

export const handler = handle(main);
