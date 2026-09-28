import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';
import { deleteOAuthApp, requireOwnedApp } from '../../lib/oauth-apps';
import { deleteGrantsForApp } from '../../lib/oauth-grants';

/**
 * Deletes one of the caller's own apps.
 *
 * Two steps, in this order, and the order is the whole of the correctness here.
 * Every authorization of the app is ended first — the people who connected it
 * have their grants and tokens deleted, so nothing the app was given still
 * works — and only then does the app row go. An app deleted before its tokens
 * would leave credentials behind that authenticate calls, point at no client,
 * and appear on somebody's connections screen with a name that no longer exists.
 *
 * 204 rather than a body describing what was deleted: there is nothing left to
 * describe, which is the same answer revoking a key gives.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const appId = pathParam(event, 'appId');

  await requireOwnedApp(user.userId, appId);

  await deleteGrantsForApp(appId);

  // False means it was deleted between the read above and here — the same
  // absence the read would have found a moment later, so it answers the same way.
  if (!(await deleteOAuthApp(appId))) {
    throw new HttpError(404, 'OAuth app not found');
  }

  return noContent();
}

export const handler = handle(main);
