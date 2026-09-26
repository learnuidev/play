import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCommentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addCommentCounters } from '../../lib/comments';
import { addFavourite, favouriteTargetKey } from '../../lib/favourites';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * Favourites somebody's comment.
 *
 * Same conditional write as favouriting content, and the same consequence: the
 * count on the comment only moves when a favourite row was actually created, so
 * a double tap is one favourite.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const commentId = pathParam(event, 'commentId');

  const comment = await requireCommentAccess(contentId, commentId, userId, 'read');

  const added = await addFavourite({
    userId,
    targetKey: favouriteTargetKey('COMMENT', commentId),
    targetType: 'COMMENT',
    targetId: commentId,
    // A comment is keyed by its content as well as itself, so a favourite of one
    // has to carry the content id to be readable back.
    contentId,
    createdAt: Date.now(),
  });

  if (added) await addCommentCounters(contentId, commentId, { favouriteCount: 1 });

  return ok({
    favourited: true,
    favouriteCount: comment.favouriteCount + (added ? 1 : 0),
  });
}

export const handler = handle(main);
