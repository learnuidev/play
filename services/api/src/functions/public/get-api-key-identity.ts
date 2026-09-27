import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getApiKey, toApiKey } from '../../lib/api-keys';
import { requireApiKeyCaller } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';

/**
 * Who the presented key is.
 *
 * The first call anybody makes with a new key, and the one that answers the two
 * questions a key's owner has: does this work, and what does it reach. The
 * organization is on the key itself, so one response says both.
 *
 * It reads the key's own row rather than echoing the authorizer's context,
 * because the row carries what the context does not: the name, the prefix, and
 * when the key was last used.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = requireApiKeyCaller(event);

  const record = await getApiKey(caller.keyId);
  // It authenticated a moment ago and is gone now: revoked between the
  // authorizer and here. The key is no longer a key, so the answer is the same
  // one an unknown key gets rather than a server error.
  if (!record) throw new HttpError(401, 'Unauthorized');

  return ok({ key: toApiKey(record), owner: { userId: record.userId } });
}

export const handler = handle(main);
