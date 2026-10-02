import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';
import { existingCustomerIdFor, getPaymentMethodRow } from '../../lib/payment-methods';
import { setDefaultPaymentMethod } from '../../lib/stripe';

/**
 * Choosing which card this account charges by default.
 *
 * The row is looked up **as the caller** before Stripe is told anything: the key
 * is the pair, so somebody else's card id is not found rather than found and
 * refused, and a card that is not there answers 404 — "no such card" and "not
 * yours" are the same sentence on purpose, because telling them apart would say
 * which ids exist.
 *
 * A person with no customer, or no such card, cannot have a default, and both
 * are refused for the same reason the wallet route refuses them: there is
 * nothing to point at.
 *
 * What it writes is `invoice_settings.default_payment_method` on the customer —
 * the field Stripe itself charges against — so the card this screen calls the
 * default is the card Stripe would use, rather than a flag of ours that could
 * drift from it. Nothing is returned: the caller re-reads the list, which marks
 * the default from the same field.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const paymentMethodId = pathParam(event, 'paymentMethodId');

  const existing = await getPaymentMethodRow(user.userId, paymentMethodId);
  if (!existing) throw new HttpError(404, 'That card is not saved on your account');

  const customer = await existingCustomerIdFor(user);
  if (!customer) throw new HttpError(404, 'That card is not saved on your account');

  await setDefaultPaymentMethod(customer.customerId, paymentMethodId);

  return noContent();
}

export const handler = handle(main);
