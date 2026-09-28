import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';
import { deleteGrant } from '../../lib/oauth-grants';

/**
 * Disconnects an app from the caller's account.
 *
 * The person's own revoke, and the one that has to work while nobody is looking:
 * it deletes the grant *and every token the app holds for this account*, so the
 * app stops being able to call this API on the next request rather than within
 * the hour its access token would have expired. Nothing is cached in front of
 * the authorizer, which is what makes that true.
 *
 * The app is not told, and there is no webhook: an app finds out by being
 * refused, which is the same way it finds out that an access token expired. The
 * alternative — a callback to the app when somebody disconnects it — would be
 * this service making an outbound request to a URL a client chose, which is a
 * different feature with a different threat model.
 *
 * A 404 for an app the caller has not authorized, which is the same answer an
 * app id that does not exist gets: what somebody else has connected is not a
 * caller's business, and disconnecting twice is not an error worth
 * distinguishing from disconnecting something that was never connected.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const appId = pathParam(event, 'appId');

  if (!(await deleteGrant(user.userId, appId))) {
    throw new HttpError(404, 'Connection not found');
  }

  return noContent();
}

export const handler = handle(main);
