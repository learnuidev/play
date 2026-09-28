import { API_BASE_URL, CLIENT_ID, SCOPES, authorizationUrl, redirectUri } from './config';
import { createPkce, createState } from './pkce';

/**
 * The OAuth client: the four calls that make up "sign in with Play".
 *
 * Deliberately hand-written rather than pulled from a library, because the whole
 * point of this app is to show what the flow *is*. Every request here is one of
 * the endpoints the API reference documents, and there are only four of them:
 *
 * | What | Where |
 * | --- | --- |
 * | Send somebody to the consent screen | `GET {studio}/oauth/authorize` |
 * | Spend the code | `POST /oauth/token` |
 * | Get a new pair when it expires | `POST /oauth/token`, `refresh_token` |
 * | Give it back | `POST /oauth/revoke` |
 *
 * Three things about it are the interesting part, and each is the opposite of
 * what an app that *has* a secret would do:
 *
 * - **No client secret anywhere.** This app is registered as a public client, so
 *   there is nothing to keep — PKCE is what stands in for one. A secret in a
 *   browser bundle would be a secret everybody has.
 * - **The refresh token rotates.** Every refresh spends the old one and returns
 *   a new one; a client that stores only the access token will work for an hour
 *   and then have to be authorized again. So both are written back, every time.
 * - **Sign-out is a revocation, not just a forget.** Clearing local storage
 *   leaves a working credential at Play; telling Play to revoke it is what
 *   actually ends the connection.
 */

/** What a token response carries. RFC 6749 §5.1, and exactly what Play returns. */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** What a session is, as this app stores it. */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. Kept as a deadline rather than a duration. */
  expiresAt: number;
  /** The scopes the tokens actually hold, as the response spelled them. */
  scope: string;
  /** When they were issued, so the UI can say how long it has been connected. */
  issuedAt: number;
}

export function toStoredTokens(response: TokenResponse): StoredTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    scope: response.scope,
    issuedAt: Date.now(),
  };
}

/** An OAuth error, as the token endpoint writes them: `error` and a description. */
export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    description: string,
  ) {
    super(description);
    this.name = 'OAuthError';
  }
}

/** The key the code verifier and state are parked under between the two legs. */
const PENDING_KEY = 'play-demo:pending-authorization';

interface PendingAuthorization {
  verifier: string;
  state: string;
  /** Where the person was going before they were sent to sign in. */
  returnTo: string;
}

/** Starts the flow: generates the proof, parks it, and hands back the URL to open. */
export async function beginAuthorization(returnTo: string): Promise<string> {
  const { verifier, challenge } = await createPkce();
  const state = createState();

  const pending: PendingAuthorization = { verifier, state, returnTo };
  // Session storage rather than local: this is a fact about *this* sign-in
  // attempt in *this* tab, and it should die with the tab. It is also the only
  // place the verifier exists — which is what makes a stolen code useless.
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  return authorizationUrl(state, challenge);
}

/** What came back from the consent screen, before it has been spent. */
export interface CallbackResult {
  code?: string;
  error?: string;
  errorDescription?: string;
  state?: string;
}

/** Reads the redirect's query string. */
export function readCallback(search: URLSearchParams): CallbackResult {
  return {
    ...(search.get('code') ? { code: search.get('code') as string } : {}),
    ...(search.get('error') ? { error: search.get('error') as string } : {}),
    ...(search.get('error_description')
      ? { errorDescription: search.get('error_description') as string }
      : {}),
    ...(search.get('state') ? { state: search.get('state') as string } : {}),
  };
}

/**
 * Spends the code for tokens.
 *
 * `client_secret` is absent and `code_verifier` is present, which is the whole
 * difference between a public client and a confidential one. The `redirect_uri`
 * has to be the same string the code was issued for — Play compares them exactly
 * — which is why it is derived the same way here as it was a moment ago.
 *
 * The pending authorization is consumed here: it is read once, and the code that
 * was issued for it cannot be spent twice anyway.
 */
export async function completeAuthorization(callback: CallbackResult): Promise<StoredTokens> {
  const pending = readPending();
  if (!pending) {
    throw new OAuthError(
      'invalid_request',
      'This sign-in attempt has expired. Start again from the front page.',
    );
  }

  // The login-CSRF check, and it is not optional: a callback carrying somebody
  // else's code would otherwise be spent into *this* session.
  if (!callback.state || callback.state !== pending.state) {
    throw new OAuthError('invalid_request', 'This sign-in could not be verified. Start again.');
  }
  if (!callback.code) {
    throw new OAuthError(
      callback.error ?? 'invalid_request',
      callback.errorDescription ?? 'The authorization was not completed.',
    );
  }

  const tokens = await postToken({
    grant_type: 'authorization_code',
    code: callback.code,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
    client_id: CLIENT_ID,
  });

  return toStoredTokens(tokens);
}

/**
 * Spends a refresh token for a new pair.
 *
 * The response carries a *new* refresh token and the old one stops working, so
 * the caller has to store what comes back rather than what it sent.
 */
export async function refreshTokens(refreshToken: string): Promise<StoredTokens> {
  const tokens = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
  return toStoredTokens(tokens);
}

/**
 * Hands the credential back.
 *
 * What an app calls when somebody deletes their account from it. The answer is
 * always 200 — revoking a token that is already gone is not an error — so there
 * is nothing to check beyond the request having been sent.
 */
export async function revokeTokens(token: string): Promise<void> {
  await fetch(`${API_BASE_URL}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, client_id: CLIENT_ID }).toString(),
  });
}

/** Where to send somebody once they are signed in, and forgets the note. */
export function takeReturnTo(): string {
  const pending = readPending();
  window.sessionStorage.removeItem(PENDING_KEY);
  return pending?.returnTo ?? '/';
}

function readPending(): PendingAuthorization | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAuthorization;
    if (!parsed.verifier || !parsed.state) return null;
    return { ...parsed, returnTo: parsed.returnTo || '/' };
  } catch {
    return null;
  }
}

/**
 * One call to the token endpoint, in the form RFC 6749 specifies.
 *
 * `application/x-www-form-urlencoded` and not JSON, and the errors are read in
 * the protocol's own shape rather than this API's usual `{error:{code,message}}`
 * — those two things are what make an OAuth endpoint usable by a library, and
 * they are why this function does not reuse the app's normal API helper.
 */
async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${API_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  const body = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new OAuthError(
      body.error ?? 'server_error',
      body.error_description ?? `The token endpoint answered ${response.status}.`,
    );
  }

  return body as TokenResponse;
}

/** The scopes this app asks for, for the setup card and the consent copy. */
export const REQUESTED_SCOPES: readonly string[] = SCOPES;
