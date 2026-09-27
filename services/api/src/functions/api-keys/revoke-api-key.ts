import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getApiKey, revokeApiKey } from '../../lib/api-keys';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';

/**
 * Deletes one of the caller's own keys.
 *
 * Delete is what revoking is: the key stops authenticating the moment this
 * returns — nothing is cached in front of the authorizer, and the row the hash
 * would have matched is gone — and it is gone from every listing and from the
 * table itself. There is no half state to come back to and no record left to
 * read, which is why the answer is 204 rather than a body describing a key that
 * no longer exists.
 *
 * Somebody else's key answers 404 rather than 403, and so does one already
 * revoked: which key ids exist is not a stranger's business, and after the
 * delete there is nothing to tell the two apart.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const keyId = pathParam(event, 'keyId');

  const existing = await getApiKey(keyId);
  if (!existing || existing.userId !== user.userId) {
    throw new HttpError(404, 'API key not found');
  }

  // A false return here means somebody else deleted it between the read above
  // and this call. That is the same absence the read would have found a moment
  // later, so it answers the same way.
  if (!(await revokeApiKey(keyId))) {
    throw new HttpError(404, 'API key not found');
  }

  return noContent();
}

export const handler = handle(main);
