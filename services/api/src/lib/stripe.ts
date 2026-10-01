import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

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
    throw new Error(`Stripe refused ${path}: ${message}`);
  }

  return body as T;
}

/** One Stripe price, as much of it as this service reads. */
export interface StripePrice {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
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
    return await stripeRequest<StripePrice>('GET', `prices/${encodeURIComponent(priceId)}`);
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
}): Promise<StripePrice> {
  return stripeRequest<StripePrice>('POST', 'prices', {
    currency: input.currency,
    unit_amount: String(input.amountCents),
    'product_data[name]': input.title,
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
 */
export async function createCheckoutSession(input: {
  priceId: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
  /** The buyer, for the receipt and for the webhook. */
  customerEmail?: string;
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

  if (input.customerEmail) params.customer_email = input.customerEmail;
  for (const [key, value] of Object.entries(input.metadata)) {
    params[`metadata[${key}]`] = value;
  }

  return stripeRequest<StripeCheckoutSession>('POST', 'checkout/sessions', params);
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
