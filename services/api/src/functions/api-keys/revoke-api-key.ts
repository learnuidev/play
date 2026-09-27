import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getApiKey, revokeApiKey, toApiKey } from '../../lib/api-keys';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, ok, pathParam } from '../../lib/http';

/**
 * Stops one of the caller's own keys working.
 *
 * Revoking is deleting as far as the API is concerned — the key stops
 * authenticating the moment this returns, because the authorizer caches nothing
 * — but the row stays, so the list can say what happened and when.
 *
 * Somebody else's key answers 404 rather than 403: which key ids exist is not a
 * stranger's business, and a 403 would say one does.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const keyId = pathParam(event, 'keyId');

  const existing = await getApiKey(keyId);
  if (!existing || existing.userId !== user.userId) {
    throw new HttpError(404, 'API key not found');
  }

  await revokeApiKey(keyId);

  // Read back rather than assumed: revoking a key that was already revoked
  // leaves the original timestamp alone, and the response says which one stands.
  const revoked = await getApiKey(keyId);
  return ok({ key: toApiKey(revoked ?? existing) });
}

export const handler = handle(main);
