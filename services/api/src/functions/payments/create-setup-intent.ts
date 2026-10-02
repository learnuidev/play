import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import { billingContextFor } from '../../lib/payment-methods';
import { createSetupIntent, getCustomerAddress, publishableKey } from '../../lib/stripe';

/**
 * Opening a card form.
 *
 * The marketplace draws its own card field with Stripe Elements, and an Element
 * needs three things this route hands it: a **client secret** for a SetupIntent,
 * the **publishable key** Stripe.js is loaded with, and the **billing address**
 * to open on. All three come back here rather than from the app's environment,
 * because all three are the deployment's and the account's — a publishable key
 * in `.env.local` is a copy of a value the console already holds, a client secret
 * is minted per attempt and cannot be one, and the address is what the person
 * themselves typed last time.
 *
 * **The whole address, not just the country.** It used to answer with a country
 * alone, which the form prefilled and left the postal code empty beside — so the
 * form that had been told where somebody lives still asked them to say it again,
 * which is the bug this field exists to close. What is answered here is what
 * `recordSetupIntent` wrote onto the customer when the last card was saved.
 *
 * Nothing is saved by this call. What it creates is an intent: the browser
 * confirms it, and `POST /me/payment-methods` is what turns the result into a
 * row. That split is the whole reason a card appears the moment it is saved
 * instead of when a webhook is delivered.
 *
 * The customer is resolved first — a card is saved *against* a customer, and it
 * has to be the same one this person's purchases were made under — and it is the
 * only thing an intent needs: a SetupIntent charges nothing, so it takes no
 * amount, no line item and no currency. See `billingContextFor`.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const { customerId } = await billingContextFor(user);

  const [intent, key, billingAddress] = await Promise.all([
    createSetupIntent({ customerId, metadata: { userId: user.userId } }),
    publishableKey(),
    // Their own address from the last card they saved, if they have saved one.
    // Null is "they have not said", which the form shows as empty fields rather
    // than as this deployment's country.
    getCustomerAddress(customerId),
  ]);

  if (!intent.client_secret) {
    // A SetupIntent without a client secret cannot be confirmed by anything, and
    // answering with one would be a form that renders and then does nothing.
    throw new Error(`Stripe created setup intent ${intent.id} with no client secret`);
  }

  return ok({
    setupIntentId: intent.id,
    clientSecret: intent.client_secret,
    publishableKey: key,
    billingAddress,
  });
}

export const handler = handle(main);
