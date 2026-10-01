import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import { env } from './config';

/**
 * Stripe, as far as this service needs to understand it.
 *
 * **Not the `stripe` SDK**, and deliberately: the one thing a webhook has to do
 * before it may trust a byte of its request is check a signature, and that is a
 * documented HMAC over two strings — `"{timestamp}.{raw body}"`, keyed by the
 * endpoint's signing secret. The SDK would bring a client, a type surface and a
 * version to keep in step for the whole service, in exchange for about thirty
 * lines that are written out below and can be read against Stripe's own
 * documentation.
 *
 * The credentials themselves are never in this file, in the repository, or in a
 * function's environment: `lib/config` holds the *name* of the secret, and
 * `stripeCredentials` is the one place it is read.
 */

const secrets = new SecretsManagerClient({});

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
