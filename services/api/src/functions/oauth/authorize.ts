import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok } from '../../lib/http';
import {
  RedirectableAuthorizationError,
  readAuthorizationRequest,
} from '../../lib/oauth-authorize';
import { getGrant, upsertGrant } from '../../lib/oauth-grants';
import { API_SCOPES, isApiScope } from '../../lib/oauth-scopes';
import { issueAuthorizationCode, revokeTokensForGrant } from '../../lib/oauth-tokens';
import type { ApiScope } from '../../types';

interface ApproveBody {
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

/**
 * "Allow": mints an authorization code for an app a person has just agreed to.
 *
 * The response carries the code, the URI it must be delivered to, and the state
 * the client sent — and nothing else. The studio's whole job with it is
 * `location.assign(redirectUri + '?code=…&state=…')`: it never composes the URL
 * from the query string it was opened with, because the query string is
 * attacker-supplied and a redirect built from it is an open redirector.
 *
 * The scopes are read **again** here rather than trusted from the screen. The
 * screen sends back what the person agreed to, and `approvedScopes` intersects
 * it with what the app asked for and is registered for — so a consent screen
 * that has been tampered with cannot grant more than the app could ever have
 * requested, and the ceiling was already enforced as `invalid_scope` by the
 * describe step. Every request is re-validated from scratch — the same function
 * the describe step used — so a client deleted between the two screens is caught
 * here rather than becoming a code that cannot be exchanged. The one thing not
 * re-read is `response_type`: this service implements exactly one, the first
 * screen refused anything else, and there is nothing here to ask about it.
 *
 * What is recorded is the grant: the person, the app, and the scopes, which is
 * the row the connections screen lists and the row disconnecting deletes.
 *
 * **A narrowing consent takes the app's existing tokens with it.** An app may
 * send somebody back here asking for less than it asked for last time, and the
 * tokens it already holds were minted for the wider answer: leaving them alone
 * would mean the app keeps a permission the consent screen — and the connections
 * screen — no longer says it has, for as long as its refresh token lasts, which
 * is a month. So when the new answer does not cover the old one, the credentials
 * issued under the old one are deleted, and the code this call returns is how
 * the app gets a pair that matches what the person just agreed to.
 *
 * A consent that only repeats or widens the previous answer touches nothing:
 * "Allow again" is a common thing for an app to ask for, and it must not be a
 * way for a person to break their own connection by pressing a button twice.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const body = jsonBody<ApproveBody>(event);

  let request;
  try {
    request = await readAuthorizationRequest({
      userId: user.userId,
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      responseType: 'code',
      scope: body.scope,
      state: body.state,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
    });
  } catch (err) {
    // A redirectable failure at *this* step is one that appeared between the two
    // screens — a scope removed from the app's registration, a client deleted.
    // The studio has already drawn the screen, so there is no redirect left to
    // make; the failure is shown to the person instead.
    if (err instanceof RedirectableAuthorizationError) {
      throw new HttpError(400, err.message);
    }
    throw err;
  }

  const approved = approvedScopes(body.scope, request.scopes.map((entry) => entry.scope));

  const previous = await getGrant(user.userId, request.app.appId);
  const narrowed =
    previous !== undefined && previous.scopes.some((scope) => !approved.includes(scope));

  await upsertGrant({ userId: user.userId, appId: request.app.appId, scopes: approved });
  if (narrowed) await revokeTokensForGrant(user.userId, request.app.appId);

  const code = await issueAuthorizationCode({
    clientId: request.app.clientId,
    appId: request.app.appId,
    userId: user.userId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scopes: approved,
  });

  return ok({
    code,
    redirectUri: request.redirectUri,
    ...(request.state ? { state: request.state } : {}),
  });
}

/**
 * What the person actually agreed to, as a subset of what was asked for.
 *
 * Absent means the whole request was agreed to, which is what the ordinary
 * "Allow" button sends. Anything the app did not ask for is dropped rather than
 * refused here: the intersection is already the answer the app is entitled to,
 * and the check that matters — that every scope is one the app is *registered*
 * for — has already happened above.
 */
function approvedScopes(raw: string | undefined, requested: ApiScope[]): ApiScope[] {
  if (raw === undefined) return requested;

  const approved = raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part): part is ApiScope => Boolean(part) && isApiScope(part));

  const allowed = API_SCOPES.filter(
    (scope) => approved.includes(scope) && requested.includes(scope),
  );
  if (allowed.length === 0) {
    throw new HttpError(400, 'No scopes were approved. Cancel the request instead.');
  }
  return allowed;
}

export const handler = handle(main);
