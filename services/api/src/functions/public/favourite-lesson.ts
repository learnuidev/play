import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCallerContentAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { addContentCounters } from '../../lib/contents';
import { addFavourite, favouriteTargetKey, removeFavourite } from '../../lib/favourites';
import { handle, ok, pathParam } from '../../lib/http';
import { requireScope } from '../../lib/oauth-scopes';

/**
 * Saving a lesson to somebody's favourites, and unsaving it.
 *
 * One resource with two methods, for the reason the completion endpoint has two:
 * a heart is a toggle, and `PUT`/`DELETE` is that toggle said in HTTP.
 *
 * Only `CONTENT` favourites are reachable here — lessons. Play's own list holds
 * hearts on comments and on loops as well, and those are things a person hearts
 * *while reading a discussion*, which is not a thing an app does on their behalf.
 * The target type is therefore not a parameter: `/v1` saves lessons, and says so
 * in the path.
 *
 * The write is conditional (see `addFavourite`), so favouriting twice is not two
 * favourites and not two increments — and the count in the answer is the row the
 * handler already read, moved by whether a row was actually created or removed.
 * The count is floored at zero on the way out, so a counter that ever disagreed
 * with the rows cannot be published as a negative number.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = await requireApiCaller(event);
  requireScope(caller, 'learning:write');

  const contentId = pathParam(event, 'contentId');
  const content = await requireCallerContentAccess(contentId, caller);

  if (event.httpMethod === 'DELETE') {
    const removed = await removeFavourite(
      caller.userId,
      favouriteTargetKey('CONTENT', contentId),
    );
    if (removed) await addContentCounters(contentId, { favouriteCount: -1 });

    return ok({
      favourited: false,
      favouriteCount: Math.max(0, content.favouriteCount - (removed ? 1 : 0)),
    });
  }

  const added = await addFavourite({
    userId: caller.userId,
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
