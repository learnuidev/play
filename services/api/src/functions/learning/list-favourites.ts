import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging } from '../../lib/http';
import { listFavourites, resolveFavourites } from '../../lib/favourites';

/**
 * Everything the caller has favourited, both content and comments.
 *
 * The caller is the only person who can read this: a favourite is a learner's
 * own list, so there is no route to somebody else's and no authorization step
 * beyond being signed in.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const { favourites, lastEvaluatedKey } = await listFavourites(userId, parsePaging(event));

  return ok({
    favourites: await resolveFavourites(favourites),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
