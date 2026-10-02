import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import { existingCustomerIdFor, listPaymentMethods, toSavedPaymentMethod } from '../../lib/payment-methods';
import { getCustomer } from '../../lib/stripe';

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
 * use for. Which one is the default comes from Stripe, not from the row.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const rows = await listPaymentMethods(user.userId);

  /**
   * Which of these is the default, according to Stripe.
   *
   * Read from the customer rather than kept on our own rows, so "the default" is
   * one fact in one place: the card Stripe would charge is the card this screen
   * marks. Only asked when there is a customer to ask about — a wallet with
   * nothing in it needs no round trip — and a Stripe call that fails leaves the
   * list drawn with nothing marked rather than the whole screen failing.
   */
  const customer = rows.length ? await existingCustomerIdFor(user) : null;
  const defaultId = customer ? (await getCustomer(customer.customerId)).defaultPaymentMethodId : null;

  return ok({
    paymentMethods: rows.map((row) => toSavedPaymentMethod(row, row.paymentMethodId === defaultId)),
  });
}

export const handler = handle(main);
