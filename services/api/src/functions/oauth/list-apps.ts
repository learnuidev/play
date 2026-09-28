import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import { listOAuthAppsForUser, toOAuthApp } from '../../lib/oauth-apps';

/**
 * The OAuth apps the caller has registered, newest first.
 *
 * The whole list rather than a page of it, and no `nextToken`: the number of
 * apps one person may register is capped at the same number they may hold keys
 * for, and the allowance is enforced by counting — so a list that stopped short
 * would be a list the owner cannot check their own allowance against.
 *
 * The client id is on every row. The secret is not, and cannot be: the row holds
 * a hash, so the shape this answers with carries the prefix and nothing more.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const apps = await listOAuthAppsForUser(user.userId);

  return ok({ apps: apps.map(toOAuthApp) });
}

export const handler = handle(main);
