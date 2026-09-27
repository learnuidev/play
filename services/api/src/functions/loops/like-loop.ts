import type { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addFavourite, favouriteTargetKey } from '../../lib/favourites';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { addLoopLike, listLoopsByContent } from '../../lib/loops';

/**
 * Likes a loop.
 *
 * A loop belongs to the course, so any member may like any of them — including
 * their own, which is why liking is a plain toggle rather than a judgement about
 * somebody else's work.
 *
 * The like is a conditional write, so liking twice is not two likes and not two
 * increments: the count on the loop only moves when a like row was actually
 * created.
 */
async function main(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const loopId = pathParam(event, 'loopId');

  await requireContentAccess(contentId, userId, 'read');

  // Read through the lesson's own list, because the caller may not be the owner:
  // the point of a shared loop is that it can be liked by somebody who did not
  // make it, and the owner's partition is not theirs to read.
  const loops = await listLoopsByContent(contentId);
  const loop = loops.find((candidate) => candidate.loopId === loopId);
  if (!loop) throw new HttpError(404, 'Loop not found');

  const added = await addFavourite({
    userId,
    targetKey: favouriteTargetKey('LOOP', loopId),
    targetType: 'LOOP',
    targetId: loopId,
    contentId,
    // Whose loop it is, so a like can be read back: a loop is keyed by its owner.
    targetOwnerId: loop.userId,
    createdAt: Date.now(),
  });

  if (added) await addLoopLike(loop, 1);

  return ok({ liked: true, likeCount: (loop.likeCount ?? 0) + (added ? 1 : 0) });
}

export const handler = handle(main);
