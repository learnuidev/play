import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addContentCounters } from '../../lib/contents';
import { favouriteTargetKey, removeFavourite } from '../../lib/favourites';
import { handle, ok, pathParam } from '../../lib/http';

/** Removes a favourite. Mirror of favouriting: the count only moves if a row went. */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const content = await requireContentAccess(contentId, userId, 'read');

  const removed = await removeFavourite(userId, favouriteTargetKey('CONTENT', contentId));

  if (removed) await addContentCounters(contentId, { favouriteCount: -1 });

  return ok({
    favourited: false,
    // Floored at zero so a count can never read as negative if a row and its
    // counter were ever to disagree.
    favouriteCount: Math.max(0, content.favouriteCount - (removed ? 1 : 0)),
  });
}

export const handler = handle(main);
