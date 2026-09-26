import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addContentCounters } from '../../lib/contents';
import { addFavourite, favouriteTargetKey } from '../../lib/favourites';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * Favourites a piece of content.
 *
 * The write is conditional, so favouriting twice is not two favourites and not
 * two increments: the count only moves when a row was actually created. The
 * answer reports the count as it now stands, computed from the row already
 * read, so the client can render it without asking again.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const content = await requireContentAccess(contentId, userId, 'read');

  const added = await addFavourite({
    userId,
    targetKey: favouriteTargetKey('CONTENT', contentId),
    targetType: 'CONTENT',
    targetId: contentId,
    createdAt: Date.now(),
  });

  if (added) await addContentCounters(contentId, { favouriteCount: 1 });

  return ok({
    favourited: true,
    favouriteCount: content.favouriteCount + (added ? 1 : 0),
  });
}

export const handler = handle(main);
