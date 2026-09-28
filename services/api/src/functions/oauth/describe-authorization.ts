import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import {
  RedirectableAuthorizationError,
  readAuthorizationRequest,
} from '../../lib/oauth-authorize';
import { toAppSummary } from '../../lib/oauth-apps';

/**
 * What an authorization URL is asking for, before anybody has agreed to it.
 *
 * The consent screen's one read. It answers three questions — which app is
 * asking, what it wants, and whether the person has already said yes — and it is
 * deliberately the *only* thing the screen asks the API before drawing itself,
 * because a screen that renders half an answer and then discovers it should not
 * have is a screen that has already shown somebody a redirect URI.
 *
 * ## Why a refusal can be a 200
 *
 * A failed authorization request has two possible fates, and they are not
 * interchangeable: some are shown to the person in the browser, and some are
 * reported to the app by redirecting the browser back with `error=` in the
 * query string. Which one applies is a security decision — see
 * `lib/oauth-authorize` — and it is this service's decision, not the studio's,
 * so it is this service that says which. Hence two answers with two different
 * shapes rather than one HTTP status meaning both:
 *
 * - **400** — the request names an unknown client or an unregistered redirect
 *   URI. The studio renders it and redirects **nowhere**. There is no verified
 *   place to send a browser, which is the whole reason this is fatal.
 * - **200 with `ok: false`** — everything else, and by construction the redirect
 *   URI in that answer has been validated, so the studio is allowed to use it.
 *   It is the one shape in this service that hands a caller a URL to *send a
 *   browser to*, which is why it is spelled out this way rather than folded into
 *   an error code.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const query = event.queryStringParameters ?? {};

  try {
    const request = await readAuthorizationRequest({
      userId: user.userId,
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      responseType: query.response_type,
      scope: query.scope,
      state: query.state,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
    });

    return ok({
      ok: true,
      app: toAppSummary(request.app),
      scopes: request.scopes,
      redirectUri: request.redirectUri,
      ...(request.state ? { state: request.state } : {}),
      alreadyAuthorized: request.alreadyAuthorized,
    });
  } catch (err) {
    if (err instanceof RedirectableAuthorizationError) {
      return ok({
        ok: false,
        oauthError: err.oauthError,
        message: err.message,
        redirectUri: err.redirectUri,
        ...(err.state ? { state: err.state } : {}),
      });
    }
    throw err;
  }
}

export const handler = handle(main);
