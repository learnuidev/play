import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { requireOwnedApp, toOAuthApp } from '../../lib/oauth-apps';

/**
 * One of the caller's own apps, in full.
 *
 * The screen this answers is the app's own settings page: every redirect URI,
 * every scope it is registered for, its client id, and the prefix of its secret.
 * Nobody else's app is readable here — not because the shape is secret, but
 * because everything on it is a setting, and settings are the owner's.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const record = await requireOwnedApp(user.userId, pathParam(event, 'appId'));

  return ok({ app: toOAuthApp(record) });
}

export const handler = handle(main);
