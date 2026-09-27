import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listApiKeysForUser, toApiKey } from '../../lib/api-keys';
import { requireUser } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging } from '../../lib/http';

/**
 * The caller's own keys, newest first.
 *
 * Revoked keys are kept in the list rather than filtered out: a person who cut
 * a key off and comes back a month later wants to know that they did, and a
 * list that silently loses rows is a list people re-create keys against.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  const { keys, lastEvaluatedKey } = await listApiKeysForUser(user.userId, parsePaging(event));

  return ok({
    keys: keys.map(toApiKey),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
