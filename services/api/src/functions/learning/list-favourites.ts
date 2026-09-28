import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { HttpError, encodeNextToken, handle, ok, parsePaging } from '../../lib/http';
import { listFavourites, resolveFavourites } from '../../lib/favourites';
import { FAVOURITE_TARGET_TYPES, type FavouriteTargetType } from '../../types';

/**
 * Everything the caller has favourited: content, comments and loops.
 *
 * The caller is the only person who can read this: a favourite is a learner's
 * own list, so there is no route to somebody else's and no authorization step
 * beyond being signed in.
 *
 * `?type=` narrows it to one kind. Both questions are real and they are not the
 * same one — everything you have hearted is what a profile draws, and the videos
 * you have hearted is what a page of them lists — so the kind is asked for
 * rather than a whole page being read and its other rows thrown away.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const typeParam = event.queryStringParameters?.type;
  let targetType: FavouriteTargetType | undefined;
  if (typeParam) {
    if (!FAVOURITE_TARGET_TYPES.includes(typeParam as FavouriteTargetType)) {
      throw new HttpError(400, `type must be one of: ${FAVOURITE_TARGET_TYPES.join(', ')}`);
    }
    targetType = typeParam as FavouriteTargetType;
  }

  const { favourites, lastEvaluatedKey } = await listFavourites(userId, {
    ...parsePaging(event),
    targetType,
  });

  return ok({
    favourites: await resolveFavourites(favourites),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
