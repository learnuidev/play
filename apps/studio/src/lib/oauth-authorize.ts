import type { OAuthAuthorizationParams } from '@play/types';

/**
 * The consent screen's two URL-shaped jobs, in one place.
 *
 * Both are about the same thing — a URL that carries an authorization request,
 * and a URL that carries its answer — and both are places where getting it
 * slightly wrong is a security bug rather than a cosmetic one. The rules:
 *
 * - **The request is read, never rebuilt.** The parameters arrive from a third
 *   party's OAuth library and are handed to the API exactly as they came. A page
 *   that reassembled them from a parsed object would be a page that can change a
 *   redirect URI on the way through.
 * - **The answer is sent to the API's own URI.** The redirect back to the app is
 *   built from the `redirectUri` the *API* returned — the one it validated
 *   against the app's registered list — and never from the query string this
 *   page was opened with. That is the single most important line in this file:
 *   an open redirector with a consent screen in front of it is a phishing page
 *   wearing this product's name.
 */

/** The parameters of an authorization request, as an OAuth client built them. */
const PARAMETERS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
] as const;

export type AuthorizationParamsResult =
  | { ok: true; params: OAuthAuthorizationParams }
  | { ok: false; missing: string[] };

/**
 * The authorization request in a query string, or the names of what is missing.
 *
 * `scope` and `state` are the only two that may be absent — the API defaults the
 * scopes to everything the app is registered for, and `state` is optional in the
 * specification. Everything else is required, and the page says which rather
 * than forwarding a half-built request for the API to refuse in its own words:
 * "response_type is required" is a true sentence that tells an app's author
 * nothing about which of their parameters went missing on the way here.
 */
export function authorizationParamsFrom(search: URLSearchParams): AuthorizationParamsResult {
  const read = (name: (typeof PARAMETERS)[number]) => search.get(name) ?? undefined;

  const required = PARAMETERS.filter((name) => name !== 'scope' && name !== 'state');
  const missing = required.filter((name) => !read(name));
  if (missing.length > 0) return { ok: false, missing };

  const scope = read('scope');
  const state = read('state');

  return {
    ok: true,
    params: {
      // Non-empty: `missing` was empty, and it is the same list of names.
      client_id: read('client_id')!,
      redirect_uri: read('redirect_uri')!,
      response_type: read('response_type')!,
      code_challenge: read('code_challenge')!,
      code_challenge_method: read('code_challenge_method')!,
      ...(scope ? { scope } : {}),
      ...(state ? { state } : {}),
    },
  };
}

/**
 * Where the app is sent back to, with the answer in the query string.
 *
 * `new URL` rather than string concatenation, because a registered redirect URI
 * may already carry a query string of its own — `https://app.example/cb?tenant=x`
 * is a perfectly ordinary registration — and appending to it with a `?` produces
 * a URL whose `code` is buried inside somebody else's parameter. It also gets
 * the custom scheme of a native app right (`com.example.app://callback`), which
 * a `URLSearchParams` over the whole string does not.
 */
export function authorizationRedirectUrl(
  redirectUri: string,
  answer: { code?: string; error?: string; errorDescription?: string; state?: string },
): string | null {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    // Only reachable if the API hands back a URI it could not have validated,
    // which would be a contract broken rather than a request refused. `null`
    // rather than a throw, because the caller's alternatives — an error screen
    // on the consent page, a sentence on the button that was pressed — are both
    // better than an exception out of an effect, which is a blank page.
    return null;
  }

  if (answer.code) url.searchParams.set('code', answer.code);
  if (answer.error) url.searchParams.set('error', answer.error);
  if (answer.errorDescription) url.searchParams.set('error_description', answer.errorDescription);
  // Echoed verbatim, and unset rather than empty when there was none: a client
  // that did not send a state must not receive one, or it reads as a mismatch.
  if (answer.state) url.searchParams.set('state', answer.state);

  return url.toString();
}

/** The consent URL for an app, which is what its author copies out of the studio. */
export function authorizationUrlFor(origin: string, clientId: string, redirectUri: string): string {
  const url = new URL('/oauth/authorize', origin);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', 'GENERATED-BY-THE-CLIENT');
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
