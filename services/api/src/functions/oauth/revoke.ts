import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  handleOAuth,
  oauthParams,
  oauthResponse,
  readClientCredentials,
  requireParam,
} from '../../lib/oauth-http';
import { authenticateClient } from '../../lib/oauth-apps';
import { deleteToken, findTokenBySecret, revokeTokensForGrant } from '../../lib/oauth-tokens';

/**
 * Token revocation, as RFC 7009 defines it.
 *
 * What an app calls when it is done with somebody: the user removed their
 * account from the app, or the app is being shut down, and it wants to hand the
 * credential back rather than hold one it will never use. It is not the same
 * thing as a person disconnecting an app — that is the connections screen, and
 * it ends the authorization itself — but it arrives at the same place: the
 * tokens stop existing.
 *
 * Three rules from the specification, each of which is a decision somebody would
 * otherwise get wrong:
 *
 * - **The answer is always 200**, even for a token that never existed, a token
 *   belonging to another client, or one already revoked. A 404 would turn this
 *   endpoint into a way to ask "is this string a token", and it would tell a
 *   client that its own token had already been revoked by somebody else — which
 *   is exactly the case where an attacker would rather nobody knew.
 * - **A refresh token takes its access tokens with it.** RFC 7009 §2.1 asks for
 *   this, and the reason is practical: a client that revokes its refresh token
 *   believes it has given the credential back, and an access token that keeps
 *   working for another hour makes that belief false.
 * - **A token belonging to another client is not touched**, and is not reported
 *   as an error either. Authenticating the client is what makes the token safe
 *   to act on; without that check, one app could revoke another's credentials by
 *   guessing at strings.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = oauthParams(event);
  const credentials = readClientCredentials(event, params);
  const app = await authenticateClient(credentials);

  const presented = requireParam(params, 'token');
  const record = await findTokenBySecret(presented);

  if (record && record.appId === app.appId) {
    if (record.kind === 'refresh') {
      await revokeTokensForGrant(record.userId, record.appId);
    } else {
      await deleteToken(record.tokenId);
    }
  }

  return oauthResponse({});
}

export const handler = handleOAuth(main);
