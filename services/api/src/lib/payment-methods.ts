import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { SavedPaymentMethod, SavedPaymentMethodRow } from '../types';
import type { AuthUser } from './auth';
import { env } from './config';
import { documentClient as client } from './dynamodb';
import { listPaymentsForUser } from './payments';
import {
  createCustomer,
  getPaymentMethod,
  getSetupIntent,
  setCustomerAddress,
  toBillingAddress,
  type StripePaymentMethod,
} from './stripe';

export const PAYMENT_METHODS_TABLE = env.paymentMethodsTableName;

/**
 * What a course with no currency set sells for.
 *
 * The product's own fallback everywhere a price is read — `space.currency ??
 * 'usd'` — so it is the right answer here too rather than a second opinion:
 * somebody who has never bought anything is offered the methods a page in this
 * deployment's money offers.
 */
const DEFAULT_CURRENCY = 'usd';

/**
 * The cards a person has saved, which is the one thing this service knows about
 * them that is about money.
 *
 * ## What is stored, and what is not
 *
 * Not the card. A card number was typed into Stripe's own page and never reaches
 * this service — what is written here is the `pm_…` token Stripe returned, the
 * customer it is attached to, and the four facts a person recognizes their own
 * card by: brand, last four digits, expiry month and year. Anything more would be
 * this service holding a payment credential, which is exactly the thing an
 * integration with a payment processor exists to avoid.
 *
 * ## Why the read is by the caller's own id
 *
 * Every query here is keyed by the `sub` the token carries, so a route cannot
 * name somebody else's card even by mistake — the same reason a profile is read
 * under `/me` with no id in the path. The one route that takes an id is removal,
 * and it removes a card *of the caller's*, checked before Stripe is called.
 */

/** Every card this person has saved, oldest first. */
export async function listPaymentMethods(userId: string): Promise<SavedPaymentMethodRow[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: PAYMENT_METHODS_TABLE,
      KeyConditionExpression: '#userId = :userId',
      ExpressionAttributeNames: { '#userId': 'userId' },
      ExpressionAttributeValues: { ':userId': userId },
      // The order they were saved in, which is the order a person remembers
      // adding them — not newest first, which is the order list screens
      // usually want and the wrong one for a wallet.
      ScanIndexForward: true,
    }),
  );

  return (res.Items ?? []) as SavedPaymentMethodRow[];
}

/**
 * A card as the person who saved it reads it.
 *
 * The row is not the wire shape, and the difference is deliberate: `userId` is
 * the caller's own and says nothing to them, and `stripeCustomerId` is an
 * identifier from another system that no screen has any use for. What is left is
 * the card as somebody recognizes it — and mapping here rather than in the
 * client is what keeps a handler from answering with a row it happens to hold.
 */
export function toSavedPaymentMethod(
  row: SavedPaymentMethodRow,
  /** Whether Stripe would charge this card by default — see `getCustomer`. */
  isDefault = false,
): SavedPaymentMethod {
  return {
    paymentMethodId: row.paymentMethodId,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.expMonth,
    expYear: row.expYear,
    createdAt: row.createdAt,
    isDefault,
  };
}

export async function getPaymentMethodRow(
  userId: string,
  paymentMethodId: string,
): Promise<SavedPaymentMethodRow | undefined> {
  const res = await client.send(
    new GetCommand({
      TableName: PAYMENT_METHODS_TABLE,
      Key: { userId, paymentMethodId },
    }),
  );

  return res.Item as SavedPaymentMethodRow | undefined;
}

export async function putPaymentMethod(row: SavedPaymentMethodRow): Promise<void> {
  await client.send(new PutCommand({ TableName: PAYMENT_METHODS_TABLE, Item: row }));
}

/**
 * Forgetting a card.
 *
 * **After** Stripe has detached it, never before: the row is what this service
 * shows a person, and a card removed from here while Stripe still holds it would
 * be a card that reappears on the next checkout page — see `detachPaymentMethod`.
 * A conditional delete would be more careful about a double-press, and there is
 * nothing to protect: deleting a row that is already gone is the same outcome.
 */
export async function deletePaymentMethodRow(
  userId: string,
  paymentMethodId: string,
): Promise<void> {
  await client.send(
    new DeleteCommand({
      TableName: PAYMENT_METHODS_TABLE,
      Key: { userId, paymentMethodId },
    }),
  );
}

/**
 * What a card form needs to know about the person filling it in.
 *
 * Two answers, from one set of reads: the **customer** a new card is attached
 * to, and the **currency** the session is opened in.
 */
export interface BillingContext {
  customerId: string;
  /** ISO 4217, lower case, as Stripe spells it. */
  currency: string;
}

/**
 * What this person's cards and purchases stand on, in Stripe.
 *
 * Three places a customer can already exist, checked in the order that costs
 * least:
 *
 * 1. **a card they have saved** — which records the customer it was attached to,
 *    so anybody with a card answers here;
 * 2. **a payment they have made** — a purchase is where a customer is worth
 *    making, so `customerForPurchase` makes one for a first-time buyer and the
 *    webhook writes its id onto the payment row: anybody who has bought anything
 *    answers here;
 * 3. **nowhere**, in which case one is created.
 *
 * The order matters beyond cost: finding the *same* customer the purchases were
 * made under is what puts a person's cards and their receipts on one row in
 * Stripe's dashboard, which is where a support question starts.
 *
 * A customer created here and then never used — somebody who opened the card
 * form and closed it — is an empty customer in the dashboard. It is left alone
 * rather than deleted: deleting customers is how a receipt loses the name it was
 * issued to.
 *
 * ## The currency, and why a card form needs one
 *
 * A **setup session has no amount**, and Stripe still requires a currency for
 * it: which payment methods a hosted page may offer is partly a currency
 * question — a US bank debit is USD, a SEPA debit EUR — so the page cannot be
 * built without one. `Missing required param: currency` is the refusal, and it
 * arrives after the mode is accepted, which is what makes it look unrelated to
 * the mode.
 *
 * The answer is the currency this person actually buys in: the one on their most
 * recent purchase. Not a constant, because a constant would be this service
 * deciding what money a deployment takes — and the same list of payments is
 * already being read here for the customer, so the honest answer costs nothing.
 * Somebody who has never bought anything gets the product's own default, which
 * is what a course with no currency set sells for.
 */
export async function billingContextFor(user: AuthUser): Promise<BillingContext> {
  const known = await existingCustomerIdFor(user);
  const currency = known?.currency ?? DEFAULT_CURRENCY;

  if (known) return { customerId: known.customerId, currency };

  const created = await createCustomer({
    ...(user.email ? { email: user.email } : {}),
    userId: user.userId,
  });
  return { customerId: created.id, currency };
}

/**
 * The customer this person already has, **without making one**.
 *
 * The difference matters on a read. A wallet that is empty is a wallet that
 * needs no customer, and a page that created one for merely being looked at
 * would leave an empty customer behind for every person who ever opened their
 * account — which is exactly what the comment above calls out as the thing to
 * avoid. Only the two routes that are about to *save* something create one.
 */
export async function existingCustomerIdFor(
  user: AuthUser,
): Promise<{ customerId: string; currency: string } | null> {
  const cards = await listPaymentMethods(user.userId);
  const payments = await listPaymentsForUser(user.userId);
  const currency = payments.find((payment) => payment.currency)?.currency ?? DEFAULT_CURRENCY;

  const fromCard = cards[0]?.stripeCustomerId;
  if (fromCard) return { customerId: fromCard, currency };

  const fromPayment = payments.find((payment) => payment.stripeCustomerId)?.stripeCustomerId;
  if (fromPayment) return { customerId: fromPayment, currency };

  return null;
}

/** The one place a buyer's customer is wanted without the rest. */
export async function stripeCustomerIdFor(user: AuthUser): Promise<string> {
  return (await billingContextFor(user)).customerId;
}

/**
 * Writing down the card somebody just entered.
 *
 * The intent names the card and nothing else, so the card is two reads away: the
 * setup intent says which payment method was saved, and the payment method says
 * which brand and which four digits it is. Both are needed, because a row with a
 * token and no digits is a card nobody can recognize in a list.
 *
 * ## What it refuses, and why that is the point
 *
 * - **An intent that has not succeeded** has saved nothing, whatever the browser
 *   says: the status is Stripe's, and it is the only answer that counts.
 * - **An intent belonging to another customer** is refused rather than recorded.
 *   The id travels through a browser, so the check that it belongs to *this*
 *   caller's Stripe customer is the whole of the authorization here.
 * - **A payment method that is not a card** — Stripe Link and the bank debits
 *   are their own types, with no brand and no last four digits — is refused too.
 *   That refusal is what a wallet full of nothing was made of once: the hosted
 *   page offered Link, somebody used it, and the row was never written with
 *   nothing anywhere saying why. The form this service draws collects a card,
 *   so a `link` here means something is wrong upstream rather than that a person
 *   did something unusual.
 */
export async function recordSetupIntent(input: {
  userId: string;
  setupIntentId: string;
  /**
   * The customer this user's cards belong to. Omitted only by the webhook, which
   * has no caller to check against — a route always passes it.
   */
  expectedCustomerId?: string;
}): Promise<SavedPaymentMethodRow | null> {
  const intent = await getSetupIntent(input.setupIntentId);

  if (intent.status !== 'succeeded' || !intent.payment_method) return null;
  if (input.expectedCustomerId && intent.customer !== input.expectedCustomerId) {
    throw new Error(
      `Setup intent ${intent.id} belongs to ${intent.customer}, not to this account's customer`,
    );
  }

  const method = await getPaymentMethod(intent.payment_method);
  const card = cardOf(method);
  // A payment method that is not a card — a bank debit, a wallet — is refused
  // rather than stored with empty digits. This screen saves cards; a method of
  // another kind would be a row the screen cannot draw.
  if (!card) return null;

  // The customer the intent names. An absent one leaves the field off rather
  // than writing an empty string into it: an empty string reads as a customer id
  // everywhere it is used (falsy, so a new customer gets made) and is a value in
  // the table that looks like data and is not.
  const customerId = intent.customer ?? undefined;

  const row: SavedPaymentMethodRow = {
    userId: input.userId,
    paymentMethodId: method.id,
    ...(customerId ? { stripeCustomerId: customerId } : {}),
    brand: card.brand,
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
    // The first save is the moment the row exists; a re-delivered event must not
    // move it, so the write reads what is already there.
    createdAt: (await getPaymentMethodRow(input.userId, method.id))?.createdAt ?? Date.now(),
  };

  await putPaymentMethod(row);

  // The address the card was saved with becomes the account's, so the next form
  // — this one, or the marketplace's checkout — opens where this one ended.
  // **All of it, and not only the country**: remembering the country alone left
  // every later form with an empty postal code under a filled-in country, which
  // reads as the form asking for the same details over again. A method that came
  // without an address changes nothing: no address is not an address.
  const address = toBillingAddress(method.billing_details?.address);
  if (address && customerId) await setCustomerAddress(customerId, address);

  return row;
}

/**
 * The customer a purchase belongs to, with the address the buyer paid with kept
 * on it.
 *
 * ## Why a purchase, and not the checkout route
 *
 * That route deliberately does not make a customer: it runs when a page opens,
 * and one per abandoned checkout is a dashboard full of empty customers. So a
 * buyer who has never saved a card arrives at this point with **no customer at
 * all** — and until this function existed, that was the end of it. They bought a
 * course, and the next checkout opened on an empty postal code, and the one after
 * that, because there was nowhere to have kept what they typed.
 *
 * A payment is the moment an account is worth a customer: the address is in hand,
 * the money has moved, and every card and every later purchase belongs against
 * it. So one is made here for a first-time buyer, and the address they paid with
 * is written onto it in the same breath.
 *
 * ## The address comes out of the payment method
 *
 * Which is the only place it exists. The card form writes its own address as it
 * confirms — the person is standing there — but a purchase never passes through
 * that form: what Stripe collected is inside the `pm_…` the intent was confirmed
 * with, which nothing in the marketplace can see. This reads it back.
 *
 * ## Best effort, and that is the design
 *
 * Everything here is for the *next* visit rather than for this purchase, so a
 * Stripe call that fails is logged and the payment is recorded anyway — where
 * throwing would ask Stripe to re-deliver an event for money that has already
 * been taken and a course that is already enrolled. What is returned is the
 * customer the intent named, if it named one, so the payment row keeps its link
 * even when the address could not be read.
 */
export async function customerForPurchase(input: {
  userId: string;
  email?: string;
  /** The customer the intent was confirmed under, when it had one. */
  customerId?: string | null;
  /** The `pm_…` it was confirmed with. Without one there is no address to keep. */
  paymentMethodId?: string | null;
}): Promise<string | null> {
  const existing = input.customerId ?? null;
  if (!input.paymentMethodId) return existing;

  try {
    const method = await getPaymentMethod(input.paymentMethodId);
    const address = toBillingAddress(method.billing_details?.address);

    if (existing) {
      if (address) await setCustomerAddress(existing, address);
      return existing;
    }

    // Nobody to keep it on. An address with no customer means a customer worth
    // making; a payment method with no address means there is nothing to keep,
    // and making one would be an empty customer for a purchase that did not need
    // it.
    if (!address) return null;

    const created = await createCustomer({
      ...(input.email ? { email: input.email } : {}),
      userId: input.userId,
    });
    await setCustomerAddress(created.id, address);
    return created.id;
  } catch (error) {
    console.error(`Could not keep the billing address of ${input.userId}`, error);
    return existing;
  }
}

/** The card details of a payment method, or nothing when it is not a card. */
function cardOf(method: StripePaymentMethod): NonNullable<StripePaymentMethod['card']> | null {
  if (method.type !== 'card' || !method.card) return null;
  return method.card;
}
