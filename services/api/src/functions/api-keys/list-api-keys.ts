import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listApiKeysForUser, toApiKey } from '../../lib/api-keys';
import { requireUser } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging } from '../../lib/http';

/**
 * The caller's own keys, newest first.
 *
 * Every one of them works: revoking deletes a key rather than marking it, so
 * there is no revoked state in this table to return. What this answers is the
 * whole of "which credentials exist", which is the question a key list is read
 * to decide.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const { keys, lastEvaluatedKey } = await listApiKeysForUser(
    user.userId,
    parsePaging(event),
  );

  return ok({
    keys: keys.map(toApiKey),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
