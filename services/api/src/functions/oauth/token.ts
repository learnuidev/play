import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { OAuthError, handleOAuth, oauthParams, oauthResponse, readClientCredentials, requireParam } from '../../lib/oauth-http';
import { authenticateClient } from '../../lib/oauth-apps';
import { getGrant, touchGrant } from '../../lib/oauth-grants';
import { API_SCOPES } from '../../lib/oauth-scopes';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  deleteToken,
  issueTokens,
  redeemAuthorizationCode,
  redeemRefreshToken,
  revokeTokensForGrant,
  spendRefreshToken,
} from '../../lib/oauth-tokens';
import type { ApiScope, OAuthAppRecord, OAuthTokenRecord } from '../../types';

/**
 * The token endpoint: where an authorization code, or a refresh token, becomes
 * an access token.
 *
 * The one endpoint on this service that a third party's *backend* calls, and it
 * is therefore the one endpoint that has to be exactly what the specification
 * says it is: form-encoded parameters, the RFC-shaped error body, `no-store` on
 * every answer, and both client authentication methods (`client_secret_basic`
 * and `client_secret_post`) because which one an integrator's library uses is
 * not something they chose.
 *
 * Two grants, and no more:
 *
 * - `authorization_code` — the flow a person is in the middle of. The code is
 *   spent here, PKCE is verified here, and the tokens that come out act as the
 *   person who pressed Allow.
 * - `refresh_token` — the flow nobody is watching. The refresh token is rotated:
 *   spent, and replaced by a new pair.
 *
 * `client_credentials` is deliberately **not** implemented. It is the grant for
 * an app acting as itself, with no person behind it — and that is precisely what
 * an API key already is, with a screen for making one, a reach its owner chose,
 * and an organization that can revoke it. Adding it here would be a second
 * answer to a question that has one, and the answer would be worse: a token with
 * no `userId` reaching routes whose authorization is written in terms of a
 * person.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = oauthParams(event);
  const grantType = requireParam(params, 'grant_type');
  const credentials = readClientCredentials(event, params);
  const app = await authenticateClient(credentials);

  if (grantType === 'authorization_code') {
    return exchangeCode(params, app);
  }
  if (grantType === 'refresh_token') {
    return refreshSession(params, app);
  }

  throw new OAuthError(
    'unsupported_grant_type',
    `${grantType} is not supported. This service implements authorization_code and refresh_token.`,
  );
}

/**
 * Spends an authorization code for tokens.
 *
 * Every reason a code cannot be spent is one answer to the client —
 * `invalid_grant` — because a caller holding a wrong code must not be told
 * *which* part of it was wrong: whether the client id matched, whether the
 * redirect URI matched, whether the verifier was right. The distinctions are
 * logged, not answered.
 *
 * `redirect_uri` is required rather than optional, which is stricter than RFC
 * 6749 allows and is what this service's own authorization step always sends: a
 * code is bound to the URI it was issued for, and the exchange requiring the
 * same one is what makes a code that was intercepted on its way to a legitimate
 * app useless to a redirect somebody else controls.
 */
async function exchangeCode(
  params: Record<string, string>,
  app: OAuthAppRecord,
): Promise<APIGatewayProxyResult> {
  const redemption = await redeemAuthorizationCode({
    code: requireParam(params, 'code'),
    clientId: app.clientId,
    redirectUri: requireParam(params, 'redirect_uri'),
    codeVerifier: requireParam(params, 'code_verifier'),
  });

  if (!redemption.ok) {
    // The reason is logged and not answered, and that is the whole of the
    // distinction: telling the holder of a stolen code *which* part of it was
    // wrong — the client id, the redirect URI, the verifier — would tell them
    // which parameter to fix, and telling them it was not the code itself would
    // confirm that the code exists and is still live.
    console.warn('Authorization code refused', { appId: app.appId, reason: redemption.reason });
    throw new OAuthError('invalid_grant', REFUSED_CODE);
  }

  const { record } = redemption;
  const tokens = await issueTokensWhileConnected(
    app,
    record.userId,
    record.scopes,
  );

  // The person's connection is live from the moment its first token is: the
  // connections screen says when the app was last used, and this is the first
  // thing that can truthfully be called using it.
  await touchGrant(record.userId, app.appId);

  return oauthResponse(tokenResponse(tokens.accessToken, tokens.refreshToken, tokens.scopes));
}

/**
 * Rotates a refresh token into a new pair.
 *
 * The old token is spent **before** the new one is minted, and the order is the
 * security property: a refresh token that is presented twice — once by the app
 * it belongs to and once by whoever took a copy — is a token that can only be
 * spent once, so the copy is refused rather than being a second, silent way into
 * somebody's account. The cost is that a client which loses this response has to
 * be authorized again, which is a real cost and the one this trade is worth
 * paying: see `issueTokens`.
 *
 * `scope` may narrow the new token and may not widen it. An app that no longer
 * needs a permission can ask for less without a person having to be shown
 * another consent screen; asking for *more* is what the consent screen is for.
 */
async function refreshSession(
  params: Record<string, string>,
  app: OAuthAppRecord,
): Promise<APIGatewayProxyResult> {
  const token = requireParam(params, 'refresh_token');

  const record = await redeemRefreshToken({ token, appId: app.appId });
  if (!record) {
    throw new OAuthError('invalid_grant', 'The refresh token is not valid for this client');
  }

  const scopes = narrowScopes(params.scope, record);

  // The grant is the authority on whether this app may still act as this person,
  // and the row is deleted the moment somebody disconnects — before the tokens
  // are swept, deliberately (see `deleteGrant`). So a refresh token that is
  // still lying around after a disconnect, because a sweep raced it, is refused
  // here rather than being spent.
  if (!(await getGrant(record.userId, app.appId))) {
    await deleteToken(record.tokenId);
    throw new OAuthError('invalid_grant', REFUSED_DISCONNECTED);
  }

  // Spending it has to *succeed*. Two refreshes arriving at the same instant —
  // an app that retried, or an app and whoever copied its token — both read the
  // row above and both reach this line; the deletion is conditional, so exactly
  // one of them wins and the other is refused here rather than being handed a
  // second pair. Without this check the loser would issue tokens anyway, which
  // is the replay that rotation exists to prevent.
  if (!(await spendRefreshToken(record.tokenId))) {
    throw new OAuthError(
      'invalid_grant',
      'The refresh token has already been used. Start the authorization again.',
    );
  }

  const tokens = await issueTokensWhileConnected(app, record.userId, scopes);

  await touchGrant(record.userId, app.appId);

  return oauthResponse(tokenResponse(tokens.accessToken, tokens.refreshToken, tokens.scopes));
}

/**
 * Issues a pair, and refuses if the grant behind it is gone.
 *
 * The second half of the race `deleteGrant` describes. Disconnecting deletes the
 * grant row and *then* sweeps the tokens it produced, so a renewal that was
 * already in flight when the row went can write a new pair into the moment
 * between the sweep's read and its deletes — credentials nothing will ever look
 * at again, for an app somebody has disconnected.
 *
 * Checking after the write is what closes it, and the order is the point: if the
 * grant is still there now, the sweep has not read the index yet and will find
 * the pair it is about to see; if it is gone, this deletes what it just issued
 * and refuses. Either way the app ends up disconnected, which is what the person
 * asked for and the only outcome that is not a lie on a screen.
 *
 * A cost of one read per token exchange, on an endpoint that is called once an
 * hour per connection: nothing like the per-request price the authorizer pays,
 * and it buys the one guarantee revocation cannot make on its own.
 */
async function issueTokensWhileConnected(
  app: OAuthAppRecord,
  userId: string,
  scopes: ApiScope[],
): Promise<{ accessToken: string; refreshToken: string; scopes: ApiScope[] }> {
  const tokens = await issueTokens({
    clientId: app.clientId,
    appId: app.appId,
    userId,
    scopes,
  });

  if (!(await getGrant(userId, app.appId))) {
    await revokeTokensForGrant(userId, app.appId);
    throw new OAuthError('invalid_grant', REFUSED_DISCONNECTED);
  }

  return tokens;
}

/**
 * The scopes a refreshed token is issued with: the ones it had, or fewer.
 *
 * A scope the original grant did not hold is an `invalid_scope` rather than a
 * silent trim, for the same reason a client is refused an unregistered scope at
 * the authorization step: an app that asked for `lessons:stream` and was given
 * an access token without it would fail on the next call, somewhere else, for a
 * reason nothing in the exchange said.
 */
function narrowScopes(raw: string | undefined, record: OAuthTokenRecord): ApiScope[] {
  if (raw === undefined) return record.scopes;

  const requested = raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (requested.length === 0) return record.scopes;

  const notHeld = requested.filter((scope) => !record.scopes.includes(scope as ApiScope));
  if (notHeld.length > 0) {
    throw new OAuthError(
      'invalid_scope',
      `This grant does not hold: ${[...new Set(notHeld)].join(', ')}`,
    );
  }

  return API_SCOPES.filter((scope) => requested.includes(scope) && record.scopes.includes(scope));
}

/** The RFC 6749 §5.1 token response. */
function tokenResponse(
  accessToken: string,
  refreshToken: string,
  scopes: ApiScope[],
): Record<string, unknown> {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    // Always present, even when it is exactly what was asked for: a client that
    // compares the two is the only way an integrator finds out that their app is
    // configured for less than they thought.
    scope: scopes.join(' '),
  };
}

/**
 * What a client is told when a code could not be spent.
 *
 * One sentence for every reason, deliberately. A caller that cannot redeem a
 * code is told to start again and nothing more: which of the four checks failed
 * is a fact about a code, and a code is a value somebody may have intercepted.
 * Telling them it was the verifier rather than the client id would narrow a
 * guessing attack; telling them it was anything other than "unknown" would
 * confirm that the code exists and is still live, which is the one thing an
 * attacker holding a stolen one wants to know before spending it.
 *
 * The reason itself is in the log line above, where the person who can act on it
 * — whoever is running the service — reads it.
 */
const REFUSED_CODE = 'The authorization code is not valid. Start the authorization again.';

/** What a client is told when the person, or the app's owner, has disconnected it. */
const REFUSED_DISCONNECTED =
  'This app is no longer connected to that account. Start the authorization again.';

export const handler = handleOAuth(main);
