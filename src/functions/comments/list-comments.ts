import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { assembleThreads, listComments, toApiComment } from '../../lib/comments';
import { listFavouriteTargets } from '../../lib/favourites';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * The discussion on a piece of content: every top-level comment with its
 * replies, oldest first.
 *
 * Each comment says whether the caller has favourited it, so a thread is drawn
 * with its hearts in the right state from the one request that read it rather
 * than a request per row.
 *
 * `MAX_THREAD_COMMENTS` is the ceiling on how much of it is read, and
 * `truncated` says when it was reached, so a client can say "showing the most
 * recent N" rather than quietly showing a partial conversation.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'read');

  const [{ comments, truncated }, favourited] = await Promise.all([
    listComments(contentId),
    listFavouriteTargets(userId, 'COMMENT'),
  ]);

  return ok({
    threads: assembleThreads(
      comments.map((comment) => toApiComment(comment, favourited.has(comment.commentId))),
    ),
    truncated,
  });
}

export const handler = handle(main);
