import type { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { favouriteTargetKey, removeFavourite } from '../../lib/favourites';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { addLoopLike, listLoopsByContent } from '../../lib/loops';

/** Takes a like back off a loop. The mirror of liking it: the count only moves if a like went. */
async function main(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const loopId = pathParam(event, 'loopId');

  await requireContentAccess(contentId, userId, 'read');

  const loops = await listLoopsByContent(contentId);
  const loop = loops.find((candidate) => candidate.loopId === loopId);
  if (!loop) throw new HttpError(404, 'Loop not found');

  const removed = await removeFavourite(userId, favouriteTargetKey('LOOP', loopId));
  if (removed) await addLoopLike(loop, -1);

  return ok({
    liked: false,
    // Floored at zero, so a count can never read as negative if a row and its
    // counter were ever to disagree.
    likeCount: Math.max(0, (loop.likeCount ?? 0) - (removed ? 1 : 0)),
  });
}

export const handler = handle(main);
