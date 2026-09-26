import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCommentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addCommentCounters } from '../../lib/comments';
import { favouriteTargetKey, removeFavourite } from '../../lib/favourites';
import { handle, ok, pathParam } from '../../lib/http';

/** Removes a favourite from somebody's comment. */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const commentId = pathParam(event, 'commentId');

  const comment = await requireCommentAccess(contentId, commentId, userId, 'read');

  const removed = await removeFavourite(userId, favouriteTargetKey('COMMENT', commentId));

  if (removed) await addCommentCounters(contentId, commentId, { favouriteCount: -1 });

  return ok({
    favourited: false,
    favouriteCount: Math.max(0, comment.favouriteCount - (removed ? 1 : 0)),
  });
}

export const handler = handle(main);
