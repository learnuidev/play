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

/** A Stripe payment intent, as much of it as this service reads. */
export interface StripePaymentIntent {
  id: string;
  /**
   * `pi_…_secret_…`: what the browser confirms the intent with.
   *
   * Null is possible in Stripe's own type and means the intent cannot be
   * confirmed by anybody, so it is treated as a failure rather than passed on.
   */
  client_secret: string | null;
  status: string;
  amount: number;
  currency: string;
}

/**
 * The charge a course is bought with.
 *
 * **An intent rather than a session, because the form is the marketplace's.**
 * Stripe's hosted page was a redirect off this product; what the Payment Element
 * confirms in the marketplace's own checkout page is an intent, so what that page
 * needs from here is not a URL but a *secret* — and the intent behind it, which
 * is the id the webhook, the receipt and every refund afterwards name.
 *
 * `automatic_payment_methods` is the one line that decides what the form offers,
 * and leaving the choice to it is on purpose: enabled, the **account's**
 * configuration decides, which is what the hosted page did and the rule this
 * service follows everywhere it is not drawing a wallet. The card form is the
 * exception — it has to collect a card, because a row with a brand and four
 * digits is drawn from what it saves — and a purchase is not that: what a
 * payment method leaves behind here is money and a receipt.
 *
 * `customerId` is passed when the buyer has one, which is what puts their saved
 * cards *inside* the form beside the empty fields. `receiptEmail` is passed
 * whenever the deployment knows their address, because that is what makes Stripe
 * send a receipt for a purchase made on this page.
 *
 * ## What an intent does not have, and it is worth saying once
 *
 * A checkout session carries **line items**: the course as a product, at a price,
 * with a tax code — which is where Stripe's own tax and Managed Payments
 * handling was computed for this deployment. An intent carries an amount and a
 * description. So a payment taken through this route is a number this service
 * resolved in `priceForCourse`, and a deployment that needs tax computed from the
 * buyer's address has to say so on the intent (`automatic_tax`, which needs a
 * customer and Stripe Tax enabled) — a decision about money rather than a detail
 * of this function, and one this file cannot make on the deployment's behalf.
 */
export async function createPaymentIntent(input: {
  amountCents: number;
  currency: string;
  /** What Stripe's dashboard and the receipt call this charge. */
  description: string;
  /** The customer that buyer already has, when they have one. */
  customerId?: string;
  /** Where the receipt goes, when the deployment knows their address. */
  receiptEmail?: string;
  metadata: Record<string, string>;
}): Promise<StripePaymentIntent> {
  const params: Record<string, string> = {
    amount: String(input.amountCents),
    currency: input.currency,
    description: input.description,
    'automatic_payment_methods[enabled]': 'true',
  };

  if (input.customerId) params.customer = input.customerId;
  if (input.receiptEmail) params.receipt_email = input.receiptEmail;
  // The metadata is what makes a payment mean something: the webhook is told the
  // intent id, and without these it would have a payment with no course and no
  // buyer attached to it.
  for (const [key, value] of Object.entries(input.metadata)) {
    params[`metadata[${key}]`] = value;
  }

  return stripeRequest<StripePaymentIntent>('POST', 'payment_intents', params);
}

/**
 * A Stripe customer: the person a card is saved against.
 *
 * A customer made implicitly is only discovered after the fact, and **saving a
 * card happens before any purchase**. So this is called for somebody who has
 * never bought anything, and the id it answers with is the one their cards hang
 * off.
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
   * The billing details the card was saved with — **the whole address**.
   *
   * This read only the country once, on the reasoning that a country is the one
   * piece of an address a person has to state because a postal code is only
   * meaningful next to it. The reasoning was fine and the conclusion was wrong:
   * the country was remembered and the postal code was not, so every later form
   * opened on a country with an empty box underneath it — a form that had plainly
   * been told something and was still asking for the same details again.
   *
   * So all of it is kept, and all of it is handed back to the next form.
   */
  billing_details?: {
    address?: StripeAddress | null;
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
 * A billing address, as this service keeps it.
 *
 * Stripe spells these in snake case (`postal_code`, `line1`) and this does not:
 * it is the shape the API answers with and both apps draw their forms from, so it
 * reads like every other field in `@play/types`. The translation happens once, in
 * `toBillingAddress`, at the edge where Stripe's JSON arrives.
 *
 * Every field is optional, because Stripe collects whatever the payment method
 * needed: a card wants a country and a postal code, a wallet may want nothing at
 * all, and a missing field is "they have not said" rather than an empty string —
 * which is the difference between a form that opens on what somebody typed last
 * time and one that opens on a blank it will not accept.
 */
export interface BillingAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** An address as Stripe spells it: snake case, and nullable in every field. */
export interface StripeAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

/**
 * Stripe's address in this service's spelling, or nothing when it is empty.
 *
 * An address with no fields is `null` rather than `{}`: both mean "they have not
 * said", and the one that is a truthy object would make every caller check for
 * emptiness itself.
 */
export function toBillingAddress(address: StripeAddress | null | undefined): BillingAddress | null {
  if (!address) return null;

  const known: BillingAddress = {
    ...(address.line1 ? { line1: address.line1 } : {}),
    ...(address.line2 ? { line2: address.line2 } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.state ? { state: address.state } : {}),
    ...(address.postal_code ? { postalCode: address.postal_code } : {}),
    ...(address.country ? { country: address.country } : {}),
  };

  return Object.keys(known).length > 0 ? known : null;
}

/**
 * The billing address this person's account is set to, if any.
 *
 * Read to **prefill** a card form — the whole address, not only the country.
 * Stripe's own customer object is where an address of record belongs: it is what
 * a receipt is issued against and what tax is computed from, and it is already
 * the thing every card and every purchase here hangs off. So what somebody types
 * into a card form is written there rather than into a table of this service's
 * own.
 *
 * A customer with no address is `null` rather than a guess: "they have not said"
 * and "they are in the United States" are different answers, and a form that
 * assumed the second would be the reason nobody ever checks it.
 */
export async function getCustomerAddress(customerId: string): Promise<BillingAddress | null> {
  return (await getCustomer(customerId)).address;
}

/**
 * Remembering it, when a payment method says what it is.
 *
 * **Only the fields that are there are sent.** Stripe merges what a `POST`
 * carries, so a field left out keeps what the customer already had, while an
 * empty string would be this service erasing somebody's address with a blank —
 * which is why these are conditional rather than assigned in a loop.
 */
export async function setCustomerAddress(
  customerId: string,
  address: BillingAddress,
): Promise<void> {
  const params: Record<string, string> = {};
  if (address.line1) params['address[line1]'] = address.line1;
  if (address.line2) params['address[line2]'] = address.line2;
  if (address.city) params['address[city]'] = address.city;
  if (address.state) params['address[state]'] = address.state;
  if (address.postalCode) params['address[postal_code]'] = address.postalCode;
  if (address.country) params['address[country]'] = address.country;

  // Nothing to say: a write with no fields is a request Stripe would answer with
  // the customer unchanged, and a round trip that cannot change anything is not
  // worth making.
  if (Object.keys(params).length === 0) return;

  await stripeRequest<{ id: string }>(
    'POST',
    `customers/${encodeURIComponent(customerId)}`,
    params,
  );
}

/**
 * The two things this service reads off a customer, in one call.
 *
 * The **billing address** and the **default payment method**, because they are
 * asked for together: a page that draws a wallet wants to know which card is the
 * default, a card form wants to know what to open on, and the marketplace's
 * checkout wants the country for instalment messaging. Three `GET`s for three
 * fields of one object would be three round trips to Stripe for the same answer.
 */
export interface StripeCustomer {
  address: BillingAddress | null;
  /** The `pm_…` id the account charges by default, if one is set. */
  defaultPaymentMethodId: string | null;
}

export async function getCustomer(customerId: string): Promise<StripeCustomer> {
  const empty: StripeCustomer = { address: null, defaultPaymentMethodId: null };

  try {
    const customer = await stripeRequest<{
      address?: StripeAddress | null;
      invoice_settings?: { default_payment_method?: string | null } | null;
    }>('GET', `customers/${encodeURIComponent(customerId)}`);

    return {
      address: toBillingAddress(customer.address),
      // An id rather than an object: nothing here expands the reference, and a
      // caller that assumed an object would read `undefined` off a string.
      defaultPaymentMethodId:
        typeof customer.invoice_settings?.default_payment_method === 'string'
          ? customer.invoice_settings.default_payment_method
          : null,
    };
  } catch {
    // A customer that cannot be read is a wallet with no default marked and a
    // form that opens unprefilled — both far smaller problems than a page that
    // will not load.
    return empty;
  }
}

/**
 * Making one card the account's default.
 *
 * `invoice_settings.default_payment_method` rather than a flag on our own row,
 * for the reason the country is on the customer too: it is the field Stripe
 * itself charges against, so a card this service calls the default and a card
 * Stripe would use cannot be two different cards. Detaching that card clears the
 * field on Stripe's side, which is the behaviour a wallet wants and one less
 * thing here to keep in step.
 */
export async function setDefaultPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<void> {
  await stripeRequest<{ id: string }>('POST', `customers/${encodeURIComponent(customerId)}`, {
    'invoice_settings[default_payment_method]': paymentMethodId,
  });
}
