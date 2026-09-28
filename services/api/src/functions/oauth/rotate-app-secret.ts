import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { requireOwnedApp, rotateClientSecret, toOAuthApp } from '../../lib/oauth-apps';

/**
 * Replaces an app's client secret, and answers with the new one exactly once.
 *
 * Rotation rather than addition: a client has one secret, and an app that thinks
 * its secret leaked wants the old one to stop working, not to hold two. The
 * moment this returns, the previous secret is refused — nothing about a client
 * secret is cached anywhere — so the app has to be redeployed with the new value
 * to keep authenticating, which is the cost of asking for this and is worth
 * stating plainly on the button that does it.
 *
 * A public client has nothing to rotate, and is told so rather than being handed
 * a secret: a secret in a browser bundle is a secret everybody has.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const appId = pathParam(event, 'appId');

  const existing = await requireOwnedApp(user.userId, appId);
  if (!existing.clientSecretHash) {
    throw new HttpError(
      400,
      'This is a public client: it authenticates with PKCE and has no secret to rotate',
    );
  }

  const { record, secret } = await rotateClientSecret(appId);

  return ok({ app: toOAuthApp(record), secret });
}

export const handler = handle(main);
