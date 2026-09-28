import type { ApiScope, OAuthAppRecord } from '../types';
import { HttpError } from './http';
import { getGrant } from './oauth-grants';
import { getOAuthAppByClientId, validateRedirectUri } from './oauth-apps';
import { API_SCOPES, isApiScope } from './oauth-scopes';

/**
 * Reading an authorization request: `GET /oauth/authorize`'s parameters, before
 * anybody has agreed to anything.
 *
 * One module rather than two because the two halves of the flow ask exactly the
 * same questions — the consent screen asks them to draw itself, and the approval
 * asks them again because a request that arrived at a screen is not a request
 * that may be trusted a moment later. Both must reach the same answers, and the
 * way to guarantee that is for there to be one function.
 *
 * ## The two kinds of failure
 *
 * RFC 6749 §4.1.2.1 splits authorization failures in two, and the split is the
 * most security-relevant sentence in the flow:
 *
 * - A request naming an **unknown client, or a redirect URI that client is not
 *   registered for**, is answered to the *browser*, as an error page. It must
 *   never be redirected anywhere: the redirect URI is the thing that has not been
 *   verified yet, and forwarding an error to an unverified URI is how an
 *   authorization server becomes an open redirector with a familiar login screen
 *   on it. These are `HttpError`s.
 * - Every other failure — an unsupported response type, a bad PKCE challenge, a
 *   scope the app is not registered for — happens *after* the client and its
 *   redirect URI are known good, and is reported to the *client* by redirecting
 *   the browser back with `error=` in the query string. These are
 *   `RedirectableAuthorizationError`, and they carry the validated URI because
 *   that is the only reason the caller could not have worked it out itself.
 */

/** A failure the client is entitled to be told about, by redirecting the browser. */
export class RedirectableAuthorizationError extends Error {
  constructor(
    /** The RFC 6749 §4.1.2.1 error code: `invalid_scope`, `unsupported_response_type`, … */
    public readonly oauthError: string,
    message: string,
    /** Already validated against the app's registered list. Safe to send a browser to. */
    public readonly redirectUri: string,
    public readonly state: string | undefined,
  ) {
    super(message);
    this.name = 'RedirectableAuthorizationError';
  }
}

/** The only response type this service implements. The implicit flow is not one. */
const SUPPORTED_RESPONSE_TYPE = 'code';

/** The only PKCE method this service implements. See `verifyCodeChallenge`. */
const SUPPORTED_CODE_CHALLENGE_METHOD = 'S256';

export interface AuthorizationRequestInput {
  /** The signed-in person deciding: the grant being read, if there is one, is theirs. */
  userId: string;
  clientId?: string;
  redirectUri?: string;
  responseType?: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

export interface AuthorizationScopes {
  scope: ApiScope;
  /** Whether the person has already agreed to this one, for this app. */
  granted: boolean;
}

export interface AuthorizationRequest {
  app: OAuthAppRecord;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  /** What the app asked for, which is what the consent screen offers. */
  scopes: AuthorizationScopes[];
  /** True when the person has already agreed to all of it. */
  alreadyAuthorized: boolean;
}

export async function readAuthorizationRequest(
  input: AuthorizationRequestInput,
): Promise<AuthorizationRequest> {
  const clientId = (input.clientId ?? '').trim();
  if (!clientId) throw new HttpError(400, 'client_id is required');

  const app = await getOAuthAppByClientId(clientId);
  // Unknown client: answered to the browser, never redirected. There is no
  // verified place to send it to, which is the entire point.
  if (!app) throw new HttpError(400, 'Unknown client_id. Check the app is registered and the id is its client id rather than its app id.');

  const redirectUri = requireRegisteredRedirectUri(app, input.redirectUri);
  const state = input.state?.trim() || undefined;

  // Past this line the client and its redirect URI are known good, so every
  // remaining failure is one the client gets to hear about.
  if ((input.responseType ?? '').trim() !== SUPPORTED_RESPONSE_TYPE) {
    throw new RedirectableAuthorizationError(
      'unsupported_response_type',
      `Only response_type=${SUPPORTED_RESPONSE_TYPE} is supported`,
      redirectUri,
      state,
    );
  }

  const method = (input.codeChallengeMethod ?? '').trim();
  if (method !== SUPPORTED_CODE_CHALLENGE_METHOD) {
    throw new RedirectableAuthorizationError(
      'invalid_request',
      `code_challenge_method=${SUPPORTED_CODE_CHALLENGE_METHOD} is required`,
      redirectUri,
      state,
    );
  }

  const codeChallenge = (input.codeChallenge ?? '').trim();
  if (!codeChallenge) {
    throw new RedirectableAuthorizationError(
      'invalid_request',
      'code_challenge is required',
      redirectUri,
      state,
    );
  }

  const scopes = readRequestedScopes(app, input.scope, redirectUri, state);

  // The grant is the *person's* answer about this app, not the app owner's:
  // whoever is looking at this screen is the one who would be granting.
  const grant = await getGrant(input.userId, app.appId);

  return {
    app,
    redirectUri,
    ...(state ? { state } : {}),
    codeChallenge,
    scopes: scopes.map((scope) => ({
      scope,
      granted: Boolean(grant?.scopes.includes(scope)),
    })),
    alreadyAuthorized: Boolean(grant && scopes.every((scope) => grant.scopes.includes(scope))),
  };
}

/**
 * The redirect URI a request is allowed to use, or the browser-facing refusal.
 *
 * Exact match against the registered list, after both sides have been through
 * the same normalisation — which is what makes `https://App.Example/cb` and
 * `https://app.example/cb` the same URI, and makes `https://app.example/cb/../x`
 * a URI that is simply not registered rather than a way past the check.
 */
function requireRegisteredRedirectUri(app: OAuthAppRecord, raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) throw new HttpError(400, 'redirect_uri is required');

  let normalized: string;
  try {
    normalized = validateRedirectUri(value);
  } catch {
    throw new HttpError(400, 'redirect_uri is not a valid redirect URI');
  }

  if (!app.redirectUris.includes(normalized)) {
    // The requested URI is repeated back, and that is deliberate: it is the one
    // parameter of the request that is already in the address bar of whoever is
    // reading this, so repeating it tells an attacker nothing they cannot see —
    // and it is the difference between "something is wrong" and "this is the
    // string that is wrong", which is what an app's author needs at the moment
    // their redirect URI does not match. The *registered* list stays out of the
    // message: that would let anybody who can construct an authorize URL read
    // back an app's configuration.
    throw new HttpError(
      400,
      `redirect_uri is not registered for this app: the request asked for ${normalized}. A redirect URI must match one of the app’s registered URIs exactly — same scheme, host, port and path.`,
    );
  }

  return normalized;
}

/**
 * The scopes a request is asking for: what the app named, checked against what
 * the app is registered for.
 *
 * Absent means "whatever this app is registered for", which is the behaviour RFC
 * 6749 §3.3 asks for and the one a client gets by constructing a consent URL in
 * a hurry.
 *
 * A request naming a scope the app is **not** registered for is refused as a
 * whole rather than trimmed to the part it may have. Trimming would be the
 * friendlier answer and it is the wrong one: an app that asked for
 * `lessons:stream` and was quietly given `lessons:read` would go on to fail in a
 * way neither its author nor the person who authorized it could explain, and the
 * failure would look like a bug in this API rather than in the app's own
 * registration.
 */
function readRequestedScopes(
  app: OAuthAppRecord,
  raw: string | undefined,
  redirectUri: string,
  state: string | undefined,
): ApiScope[] {
  const requested = (raw ?? '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (requested.length === 0) return API_SCOPES.filter((scope) => app.scopes.includes(scope));

  const unregistered = requested.filter(
    (scope) => !isApiScope(scope) || !app.scopes.includes(scope),
  );
  if (unregistered.length > 0) {
    throw new RedirectableAuthorizationError(
      'invalid_scope',
      `This app is not registered for: ${[...new Set(unregistered)].join(', ')}`,
      redirectUri,
      state,
    );
  }

  return API_SCOPES.filter((scope) => requested.includes(scope));
}
