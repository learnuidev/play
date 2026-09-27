import { authTokenOrNull } from '@play/api';
import { apiUrl } from './api-base';
import { interpolatedPath } from './api-example';
import type { ApiEndpoint } from './api-reference';

/**
 * Running one of the documented endpoints for real, from the browser.
 *
 * The reference and the thing it documents are otherwise two different objects
 * kept in step by hand; this is the part where a reader finds out whether they
 * agree. Everything here is built from the same `ApiEndpoint` the page renders,
 * so a request cannot describe an endpoint the card above it does not.
 */

/**
 * What a playground request authenticates with.
 *
 * The two credentials are the API's own two kinds of caller, which is why the
 * endpoint data already says which one it wants: a key for everything under
 * `/v1`, and the signed-in session for the endpoints that manage keys.
 */
export type PlaygroundCredential =
  | {
      kind: 'key';
      /** The secret itself. Held in this tab, and never sent anywhere but the API. */
      secret: string;
      /** What to call it in the interface: its name, or its prefix. */
      label: string;
      /** Set when this tab created the key, so the interface can offer to revoke it. */
      keyId?: string;
    }
  | { kind: 'session' };

export interface PlaygroundValues {
  path: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, string>;
}

export interface PlaygroundResult {
  status: number;
  ok: boolean;
  /** Round trip in milliseconds, as the browser measured it. */
  ms: number;
  /** The parsed body, when the response was JSON. */
  json?: unknown;
  /** The body as text, when it was not. */
  text?: string;
}

/**
 * A request that never reached the API.
 *
 * Distinct from an error *response*, and the distinction is the whole point of
 * having a type for it: a wrong key answers 403 and a wrong URL answers nothing
 * at all, and a reader testing a new key needs to be told which of those two
 * happened to them.
 */
export class PlaygroundRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaygroundRequestError';
  }
}

/** The URL a request will go to, query string and all. */
export function playgroundUrl(endpoint: ApiEndpoint, values: PlaygroundValues): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values.query)) {
    if (value.trim()) params.set(name, value.trim());
  }
  const query = params.toString();
  return `${apiUrl(interpolatedPath(endpoint, values.path))}${query ? `?${query}` : ''}`;
}

/** The JSON body a request will send, or nothing when it sends none. */
export function playgroundBody(
  endpoint: ApiEndpoint,
  values: PlaygroundValues,
): string | undefined {
  if (!endpoint.body?.length) return undefined;

  const body: Record<string, string> = {};
  for (const field of endpoint.body) {
    const value = values.body[field.name]?.trim();
    // A cleared optional field is left out rather than sent as an empty string:
    // "no organization" is the absence of the field, which is what the endpoint
    // documents and what it does.
    if (value) body[field.name] = value;
  }

  return JSON.stringify(body);
}

/**
 * Calls the endpoint, and reports what came back.
 *
 * `fetch` rejects only when the request never completed — the API is
 * unreachable, or the browser refused the response. An HTTP error is a
 * resolution, not a rejection, and comes back as a result with its status, so
 * the common case of "my key is wrong" is shown as the 403 it is.
 */
export async function runEndpoint(
  endpoint: ApiEndpoint,
  values: PlaygroundValues,
  credential: PlaygroundCredential,
): Promise<PlaygroundResult> {
  const headers: Record<string, string> = {};

  if (endpoint.auth === 'key') {
    if (credential.kind !== 'key') {
      throw new PlaygroundRequestError('This endpoint needs an API key.');
    }
    headers['x-api-key'] = credential.secret;
  } else {
    const token = await authTokenOrNull();
    if (!token) {
      throw new PlaygroundRequestError('This endpoint needs you to be signed in.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const body = playgroundBody(endpoint, values);
  if (body) headers['Content-Type'] = 'application/json';

  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(playgroundUrl(endpoint, values), {
      method: endpoint.method,
      headers,
      ...(body ? { body } : {}),
      cache: 'no-store',
    });
  } catch {
    throw new PlaygroundRequestError(
      'The request did not reach the API. The base URL above has to be the deployed one, and the API has to allow calls from this page.',
    );
  }

  const ms = Math.round(performance.now() - startedAt);
  const text = await response.text();

  // Everything this API returns is JSON, including its errors — but a proxy, a
  // WAF or an HTML error page is not, and a playground that showed nothing at
  // all for those would be hiding the one response somebody needs to see.
  try {
    return { status: response.status, ok: response.ok, ms, json: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, ok: response.ok, ms, text };
  }
}

/**
 * Whether a response came from API Gateway rather than from an endpoint.
 *
 * The gateway answers a rejected key itself, before any function runs, with its
 * own `{ "message": "..." }` — the one body shape this API never produces. Saying
 * so saves a reader from hunting for a bug in their request when the answer is
 * that the key was refused.
 */
export function isGatewayResponse(result: PlaygroundResult): boolean {
  if (result.status !== 401 && result.status !== 403) return false;
  const body = result.json;
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { message?: unknown }).message === 'string' &&
    !('error' in body)
  );
}
