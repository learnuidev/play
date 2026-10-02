import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok } from '../../lib/http';
import { billingContextFor, recordSetupIntent, toSavedPaymentMethod } from '../../lib/payment-methods';

/**
 * Saving the card a form just confirmed.
 *
 * The browser has already talked to Stripe — Elements collected the number,
 * `confirmSetup` attached it to the customer — and this route is how that
 * becomes a row. **Nothing here trusts the browser's word for it**: the setup
 * intent is read back from Stripe, and it has to be `succeeded`, to name a card,
 * and to belong to *this caller's* customer before anything is written. A client
 * that posted somebody else's intent id would be reading their card, and the
 * check is what makes that impossible rather than merely unlikely.
 *
 * ## Why a route and not the webhook
 *
 * The webhook is how a **purchase** is recorded, because money arriving is
 * Stripe's news to break — nobody in a browser can be asked to vouch for it.
 * Saving a card is the other way round: the person is standing there, the
 * confirmation happened in their browser, and the only thing a webhook adds is a
 * wait. So the card is written when the form is confirmed, and the row appears
 * in the wallet immediately.
 *
 * A setup session that *is* delivered later — an old hosted page somebody still
 * has open — is handled by the webhook as well. Both paths write the same row
 * through the same function, so they cannot disagree about it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const { setupIntentId } = jsonBody<{ setupIntentId?: string }>(event);

  if (!setupIntentId) {
    throw new HttpError(400, 'A setupIntentId is required — it is what the card form confirmed.');
  }

  const { customerId } = await billingContextFor(user);

  const card = await recordSetupIntent({
    userId: user.userId,
    setupIntentId,
    expectedCustomerId: customerId,
  });

  if (!card) {
    throw new HttpError(
      409,
      'That card was not saved: Stripe has no card on that setup intent. Fill the form in again.',
    );
  }

  return ok({ paymentMethod: toSavedPaymentMethod(card) });
}

export const handler = handle(main);
