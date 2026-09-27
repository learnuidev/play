import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listActiveApiKeysForUser, toApiKey } from '../../lib/api-keys';
import { requireUser } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging } from '../../lib/http';

/**
 * The caller's own keys that still work, newest first.
 *
 * Revoked keys are not among them. A key list is read to decide which
 * credentials exist, and a revoked key is not one of them — it cannot
 * authenticate, and the only thing left to do to it is what was already done.
 * The row is still kept; it is simply not an answer to this question.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const { keys, lastEvaluatedKey } = await listActiveApiKeysForUser(
    user.userId,
    parsePaging(event),
  );

  return ok({
    keys: keys.map(toApiKey),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
