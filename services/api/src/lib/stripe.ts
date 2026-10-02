import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import { env } from './config';

/**
 * Stripe, as far as this service needs to understand it.
 *
 * **Not the `stripe` SDK**, and deliberately. The two things this service does
 * with Stripe are a signature check — a documented HMAC over two strings — and a
 * couple of form-encoded calls to `api.stripe.com`, which is what `stripeRequest`
 * below is. The SDK would bring a client, a type surface and a version to keep in
 * step for the whole service, in exchange for code that can be read against
 * Stripe's own documentation.
 *
 * The credentials themselves are never in this file, in the repository, or in a
 * function's environment: `lib/config` holds the *names* of the secrets, and
 * `stripeCredentials` is the one place they are read.
 */

const secrets = new SecretsManagerClient({});
const ssm = new SSMClient({});

/**
 * The Stripe API, as one function.
 *
 * **Form-encoded, not JSON.** Stripe's REST API takes
 * `application/x-www-form-urlencoded` bodies and describes nested parameters with
 * brackets — `line_items[0][price]`, `metadata[spaceId]` — which is why the
 * parameter type here is a flat map of already-bracketed keys rather than
 * something recursive. Building those keys at the call site keeps the shape of
 * each request in the file that makes it, where it can be compared with Stripe's
 * documentation for that endpoint.
 *
 * There is no retry and no idempotency key. A retry here would be a *second*
 * checkout session or a second price, and Stripe's own advice for a request that
 * matters is an idempotency key chosen by the caller — which for a checkout is
 * better handled by the person pressing the button again.
 */
/**
 * A refusal from Stripe, carrying the status it was refused with.
 *
 * The message alone is not enough for one caller: **removing a saved card**. A
 * card somebody deleted in Stripe's own dashboard is a card Stripe answers 404
 * for, and that is an *outcome* rather than a failure — the row this service
 * still shows is the stale half, and asking Stripe to detach it again can only
 * ever fail. Without the status that case is indistinguishable from a network
 * error, and the card would be stuck in somebody's list forever.
 */
export class StripeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

async function stripeRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const { secretKey } = await stripeCredentials();

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(method === 'POST' ? { body: new URLSearchParams(params).toString() } : {}),
  });

  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string; type?: string } })
    | null;

  if (!response.ok) {
    // Stripe's own sentence is the useful one — "Invalid API Key provided", "No
    // such price" — and it names the field, which a generic failure would not.
    const message = body?.error?.message ?? `Stripe answered ${response.status}`;
    throw new StripeError(response.status, `Stripe refused ${path}: ${message}`);
  }

  return body as T;
}

/** One Stripe price, as much of it as this service reads. */
export interface StripePrice {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  /**
   * The product it belongs to. An **object** when the request asked Stripe to
   * expand it — which `findPrice` does — and a bare id otherwise, because that is
   * what the API does with an unexpanded reference.
   */
  product?: string | { id: string; tax_code?: string | null };
}

/**
 * The tax code of the product a price is for, or null.
 *
 * Read through the two shapes `product` comes in, so that a caller cannot get an
 * empty answer merely because nothing expanded the reference: "no tax code" and "I
 * did not ask" would otherwise be the same null, and they mean opposite things.
 */
export function productTaxCode(price: StripePrice): string | null {
  return typeof price.product === 'object' && price.product !== null
    ? (price.product.tax_code ?? null)
    : null;
}

/**
 * The Stripe price a course is sold at, created once and then reused.
 *
 * **Cached on the course** rather than created per checkout, and that is not an
 * optimisation: Stripe's dashboard is where somebody looks at what the product
 * sells, and a price created per session is one anonymous line there per
 * attempted purchase. `space.stripePriceId` is that cache, and it is why changing
 * a course's price is a write of a *number*: the next checkout finds a price that
 * no longer matches and makes a new one, and the old one is left inactive in
 * Stripe rather than deleted, because a payment already made points at it.
 *
 * No price of our own is reused by another course: a Stripe price belongs to one
 * product id, and sharing one between two courses would make Stripe's own reports
 * unable to tell them apart.
 */
export async function findPrice(priceId: string): Promise<StripePrice | null> {
  try {
    // The product is expanded rather than fetched separately: whether the price is
    // still usable depends on the *product's* tax code, and a price fetched without
    // it would answer "no tax code" for every price ever made.
    return await stripeRequest<StripePrice>(
      'GET',
      `prices/${encodeURIComponent(priceId)}?expand[]=product`,
    );
  } catch {
    // A price that has been deleted in the dashboard, or an id that belongs to
    // another Stripe account — the caller's answer is the same either way: make
    // a new one.
    return null;
  }
}

/**
 * A new Stripe price for a course.
 *
 * `product_data` inline rather than a product created first: Stripe creates the
 * product as part of the price, and a course is one product — its name is the
 * title, which is what a receipt should say. A recurring course would set
 * `recurring[interval]` here, which is the one thing that would need a decision
 * about subscription rather than one-off payment.
 */
export async function createPrice(input: {
  title: string;
  amountCents: number;
  currency: string;
  /**
   * The product tax code, required rather than optional.
   *
   * Not defaulted here: a default in this function would be a second place the
   * classification is decided, and the one that is wrong is always the one nobody
   * looked at. `lib/config` holds the deployment's answer; this takes it.
   */
  taxCode: string;
}): Promise<StripePrice> {
  return stripeRequest<StripePrice>('POST', 'prices', {
    currency: input.currency,
    unit_amount: String(input.amountCents),
    'product_data[name]': input.title,
    // The tax code belongs to the *product*, and the product is created inline with
    // the price, so this is the only place it can be set in one call. Stripe accepts
    // any string here and validates it when a session is opened, which is why a
    // wrong code shows up as a failed checkout rather than a failed price.
    'product_data[tax_code]': input.taxCode,
    // Expanded back, so the caller sees the code it just set rather than the id of
    // a product it would have to fetch to check.
    'expand[]': 'product',
  });
}

/** A Stripe checkout session, as much of it as this service reads. */
export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  payment_intent: string | null;
  amount_total: number | null;
  currency: string | null;
}

/**
 * A hosted checkout page, which is where a learner actually pays.
 *
 * **Redirect rather than embedded**: Stripe's hosted page handles the card
 * fields, the tax line, the receipt and every payment method the account has
 * enabled, and none of that is code this repository should own. The marketplace
 * sends the browser to `url` and Stripe sends it back to `successUrl`.
 *
 * The metadata is what makes a payment mean something on the way back: the
 * webhook is told the session id, and without these three it would have a payment
 * with no course and no buyer attached to it. `client_reference_id` carries the
 * same person for Stripe's own dashboard, where a support question starts.
 *
 * `customerId` is passed when the buyer has saved a card, which is what puts
 * their existing cards on Stripe's page for them to pick. It is passed *instead
 * of* `customerEmail` rather than beside it: Stripe refuses the pair, and the
 * address is already on the customer the id names.
 */
export async function createCheckoutSession(input: {
  priceId: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
  /** The buyer, for the receipt and for the webhook. */
  customerEmail?: string;
  /** The Stripe customer that buyer already has, when they have one. */
  customerId?: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
}): Promise<StripeCheckoutSession> {
  const params: Record<string, string> = {
    mode: 'payment',
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': String(input.quantity ?? 1),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.clientReferenceId,
  };

  if (input.customerId) params.customer = input.customerId;
  else if (input.customerEmail) params.customer_email = input.customerEmail;
  for (const [key, value] of Object.entries(input.metadata)) {
    params[`metadata[${key}]`] = value;
  }

  return stripeRequest<StripeCheckoutSession>('POST', 'checkout/sessions', params);
}

/**
 * A Stripe customer: the person a card is saved against.
 *
 * Stripe can create a customer implicitly from a checkout session, and it does
 * for every course bought here — but a customer made that way is only
 * discovered after the fact, and **saving a card happens before any purchase**.
 * So this is called for somebody who has never bought anything, and the id it
 * answers with is the one their cards hang off.
 *
 * Looked up before it is called rather than created every time — see
 * `stripeCustomerIdFor` in `lib/payment-methods` — because a person with two
 * cards and a purchase should be one customer in Stripe's dashboard, not three.
 */
export async function createCustomer(input: {
  email?: string;
  userId: string;
}): Promise<{ id: string }> {
  return stripeRequest<{ id: string }>('POST', 'customers', {
    ...(input.email ? { email: input.email } : {}),
    'metadata[userId]': input.userId,
  });
}

/**
 * A SetupIntent: the thing a card form confirms, and the record of what it saved.
 *
 * **`payment_method_types[0]=card`, which is the one place this service tells
 * Stripe which methods to offer.** Everywhere else the account's own
 * configuration decides, and deliberately — but a page whose whole job is "save
 * the card I pay with" has to collect a *card*: Stripe's other setup methods are
 * wallets and bank debits that are not a card, and Stripe Link in particular
 * saves as a `link` payment method with no brand and no last four digits, which
 * is a row this product cannot draw in a wallet.
 *
 * It did draw nothing, and that is worth writing down: the hosted page offered
 * Link, the person used it, the payment method came back as `link`, and the row
 * was refused as un-renderable — a saved card that never appeared anywhere,
 * with nothing in any log saying why. A form this service owns cannot make that
 * mistake.
 *
 * `usage: off_session` is the honest declaration of what these cards are for:
 * they are saved so a later purchase does not have to be typed in again.
 *
 * **Neither a currency nor Managed Payments belongs here**, and both were tried:
 * a SetupIntent takes no `currency` and no `managed_payments` — Stripe refuses
 * them as unknown parameters — because neither is a thing an intent that charges
 * nothing can have. Those two were the checkout session's requirements, and this
 * is not a checkout session.
 */
/**
 * The publishable key, read once per container.
 *
 * The one Stripe value that is **not a secret** and is nevertheless not in a
 * Lambda's environment: it is served to browsers — it is what a marketplace page
 * loads Stripe.js with — so it sits in SSM as a plain `String`, and the
 * environment carries only the parameter's *name*, like every other value this
 * service reads at request time.
 *
 * Required in the response that opens a card form, because the app cannot draw
 * an Element without it. Read here rather than handed to the frontends as
 * `NEXT_PUBLIC_…` so that a deployment has one source for it: the console
 * already shows this value on its Checklist, and a copy in `.env.local` would be
 * a second one to keep in step.
 */
let publishable: Promise<string> | undefined;

export function publishableKey(): Promise<string> {
  publishable ??= readPublishableKey().catch((error: unknown) => {
    // Not remembered, so a transient failure is not one stale error for the life
    // of the container — the same rule the CloudFront readers keep.
    publishable = undefined;
    throw error;
  });
  return publishable;
}

async function readPublishableKey(): Promise<string> {
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: env.stripePublishableKeyParam }),
  );
  const value = Parameter?.Value?.trim();
  if (!value) {
    throw new Error(
      `${env.stripePublishableKeyParam} is empty. Set it from the console's Checklist tab — ` +
        'the marketplace loads Stripe.js with the publishable key, so a card form cannot open without it.',
    );
  }
  return value;
}

export async function createSetupIntent(input: {
  customerId: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; client_secret: string | null; status: string }> {
  const params: Record<string, string> = {
    customer: input.customerId,
    usage: 'off_session',
    'payment_method_types[0]': 'card',
  };

  for (const [key, value] of Object.entries(input.metadata)) {
    params[`metadata[${key}]`] = value;
  }

  return stripeRequest<{ id: string; client_secret: string | null; status: string }>(
    'POST',
    'setup_intents',
    params,
  );
}

/** A setup intent, as much of it as this service reads. */
export interface StripeSetupIntent {
  id: string;
  /** `succeeded` once a card is on it. Anything else has saved nothing yet. */
  status: string;
  /** The card that was saved. Null until the intent succeeds. */
  payment_method: string | null;
  customer: string | null;
}

/**
 * The setup intent a completed setup session produced.
 *
 * The intent names the card and not its digits, so this is the first of the two
 * reads that turn "somebody entered a card" into a row this service can show
 * them. It is read by the **route** now rather than only by the webhook: the
 * form confirms the intent in the browser and then says so, and the server
 * checks it against Stripe before writing anything, which is what makes a saved
 * card appear immediately instead of whenever an event is delivered.

 * A null `payment_method` is still possible — an intent that was never confirmed
 * — and the caller refuses it, because a row with no card id is a card that
 * cannot be removed.
 */
export async function getSetupIntent(setupIntentId: string): Promise<StripeSetupIntent> {
  return stripeRequest<StripeSetupIntent>(
    'GET',
    `setup_intents/${encodeURIComponent(setupIntentId)}`,
  );
}

/** A payment method, as much of it as this service reads. */
export interface StripePaymentMethod {
  id: string;
  type: string;
  card?: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
  /**
   * The billing details the card was saved with.
   *
   * Only the country is read, and it is read for one reason: it is the one piece
   * of an address a person has to state, because a postal code is only
   * meaningful next to it. Whatever they chose is kept on the customer below, so
   * the next card form opens on it rather than on this deployment's country.
   */
  billing_details?: {
    address?: { country?: string | null } | null;
  } | null;
}

/** One saved payment method, by id. */
export async function getPaymentMethod(paymentMethodId: string): Promise<StripePaymentMethod> {
  return stripeRequest<StripePaymentMethod>(
    'GET',
    `payment_methods/${encodeURIComponent(paymentMethodId)}`,
  );
}

/**
 * Taking a card off a customer.
 *
 * **In Stripe first, then the row** — and that order is the point: a card
 * removed from this service but left on the customer is a card still offered on
 * Stripe's own checkout page, which is the one thing a person pressing "Remove"
 * is asking to stop. A Stripe call that fails therefore leaves the row alone and
 * the screen says so, which is the honest failure: nothing was removed.
 *
 * `detach` rather than `DELETE /payment_methods/{id}`: same resource, but the
 * detach endpoint is the documented way to remove a method from a customer, and
 * a `DELETE` is a call `stripeRequest` cannot make anyway.
 */
export async function detachPaymentMethod(paymentMethodId: string): Promise<void> {
  await stripeRequest<{ id: string }>(
    'POST',
    `payment_methods/${encodeURIComponent(paymentMethodId)}/detach`,
  );
}

/**
 * Giving money back, in full.
 *
 * A learner's own refund is a full one always: the 30-day window is this
 * product's rule and "part of the course" is not a thing to charge for. The
 * amount is left to Stripe — omitting it refunds the whole charge — so the two
 * ends cannot disagree about what full means.
 *
 * Keyed by the **payment intent**, which is what a charge is a charge of, and
 * the same id the webhook's own `charge.refunded` event names. Nothing here is
 * idempotent by key: a second call for a payment already refunded is refused by
 * Stripe, and the caller checks the row's status first anyway.
 */
export async function refundPaymentIntent(paymentIntentId: string): Promise<{ id: string }> {
  return stripeRequest<{ id: string }>('POST', 'refunds', {
    payment_intent: paymentIntentId,
  });
}

/**
 * One environment's Stripe credentials.
 *
 * Two secrets rather than one document, because they are rotated for different
 * reasons and at different times: the API key on somebody's schedule, the
 * endpoint's signing secret when the endpoint is recreated.
 */
export interface StripeCredentials {
  /** `sk_live_…` or `sk_test_…` — the key that may be spent. */
  secretKey: string;
  /** `whsec_…` — the key this deployment's webhook endpoint signs with. */
  webhookSigningSecret: string;
}

/**
 * The credentials, read once per container.
 *
 * Cached because a cold start reads them once and every event after that is a
 * request in the same container; a `GetSecretValue` per event would be a Secrets
 * Manager charge and ~40 ms on a path Stripe itself is timing. The cost of the
 * cache is that **rotating a key does not reach a warm container**: the value is
 * held until the container goes, which is minutes to hours. Rotating a Stripe key
 * is therefore two things, and the second one is not obvious — the console writes
 * the new value, and the function has to be cold again before it uses it. Waiting,
 * or a deploy that replaces the function, both do that.
 */
let cached: StripeCredentials | null = null;

export async function stripeCredentials(): Promise<StripeCredentials> {
  if (cached) return cached;

  // Both at once rather than one after the other: a webhook that is going to fail
  // for a missing signing secret should not spend a round trip discovering it
  // only once the API key has been fetched.
  const [secretKey, webhookSigningSecret] = await Promise.all([
    readSecret(env.stripeSecretName),
    readSecret(env.stripeWebhookSecretName),
  ]);

  cached = { secretKey, webhookSigningSecret };
  return cached;
}

/**
 * One secret's value, as text.
 *
 * A binary secret is refused rather than decoded: these are strings a person
 * pasted into the console, and a value that arrived as bytes means somebody
 * wrote it with a tool that did not agree with the one that reads it — which is
 * worth a sentence rather than a mangled API key at the next charge.
 */
async function readSecret(name: string): Promise<string> {
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: name }));

  if (!result.SecretString) {
    throw new Error(
      `${name} holds a binary value. The console writes these as text — re-save the Stripe ` +
        'credentials from the console\'s Checklist tab, or write the value by hand.',
    );
  }

  const value = result.SecretString.trim();
  if (!value) {
    // An empty secret is a secret that was created and never filled in, which
    // reads at the call site as "configured" and at Stripe as a 401.
    throw new Error(
      `${name} is empty. Set it from the console's Checklist tab — the Stripe credentials are ` +
        'what this deployment charges and verifies with.',
    );
  }

  return value;
}

/**
 * How long a signature stays valid, in seconds.
 *
 * Stripe's own default, and it is the whole of the replay protection: the signed
 * timestamp is inside the message, so a request captured off the wire is only
 * useful for five minutes. Kept here rather than inlined so that it reads as a
 * decision — a larger number is a longer replay window.
 */
const TOLERANCE_SECONDS = 300;

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Whether this request really came from Stripe.
 *
 * The header is `Stripe-Signature: t=<unix seconds>,v1=<hex hmac>[,v1=…]`, and
 * the signed message is the timestamp, a literal `.`, and the **raw body** — the
 * bytes as they arrived, before any JSON parsing. That is why the handler takes
 * the body as a string and parses it afterwards: a re-serialized object has
 * different bytes, and the signature would never match.
 *
 * Several `v1` values are normal: rotating an endpoint's secret leaves two valid
 * signatures on the wire for the length of the rotation, so each is tried.
 * Comparison is `timingSafeEqual` rather than `===`, because a signature check
 * that leaks how much of the guess was right is a signature check that can be
 * worn down one byte at a time.
 */
export function verifyStripeSignature(input: {
  payload: string;
  header: string | undefined;
  signingSecret: string;
  now?: number;
}): SignatureVerdict {
  const { payload, header, signingSecret } = input;
  if (!header) return { ok: false, reason: 'no Stripe-Signature header' };

  const parts = header.split(',').map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const offered = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));

  if (!timestamp || offered.length === 0) {
    return { ok: false, reason: 'the Stripe-Signature header has no t= and v1= pair' };
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    return { ok: false, reason: 'the Stripe-Signature timestamp is not a number' };
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  // Absolute difference, not `now - seconds`: a clock behind the sender would
  // otherwise make every future timestamp look valid.
  if (Math.abs(now - seconds) > TOLERANCE_SECONDS) {
    return {
      ok: false,
      reason: `the signature is ${Math.abs(now - seconds)}s old, past the ${TOLERANCE_SECONDS}s tolerance`,
    };
  }

  const expected = createHmac('sha256', signingSecret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest();

  for (const candidate of offered) {
    const theirs = Buffer.from(candidate, 'hex');
    // `timingSafeEqual` throws on a length mismatch rather than returning false,
    // and a wrong-length signature is a failed check rather than a crash.
    if (theirs.length === expected.length && timingSafeEqual(theirs, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'no v1 signature matched' };
}

/**
 * The billing country this person's account is set to, if any.
 *
 * Read to **prefill** a card form. Stripe's own customer object is where an
 * address of record belongs — it is what a receipt is issued against and what
 * tax is computed from, and it is already the thing every card and every
 * purchase here hangs off — so the choice somebody makes in a card form is
 * written there rather than into a table of this service's own.
 *
 * A customer with no address is `null` rather than a guess: "they have not said"
 * and "they are in the United States" are different answers, and a form that
 * assumed the second would be the reason nobody ever checks it.
 */
export async function getCustomerCountry(customerId: string): Promise<string | null> {
  try {
    const customer = await stripeRequest<{ address?: { country?: string | null } | null }>(
      'GET',
      `customers/${encodeURIComponent(customerId)}`,
    );
    return customer.address?.country ?? null;
  } catch {
    // A customer that cannot be read is a form that opens unprefilled, which is
    // a far smaller problem than a card form that will not open.
    return null;
  }
}

/** Remembering it, when a card says what it is. */
export async function setCustomerCountry(customerId: string, country: string): Promise<void> {
  await stripeRequest<{ id: string }>('POST', `customers/${encodeURIComponent(customerId)}`, {
    'address[country]': country,
  });
}
