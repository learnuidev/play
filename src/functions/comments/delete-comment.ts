import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCommentModerator } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addCommentCounters, deleteCommentItem, tombstoneComment } from '../../lib/comments';
import { addContentCounters } from '../../lib/contents';
import { handle, noContent, pathParam } from '../../lib/http';

/**
 * Deletes a comment.
 *
 * A comment with replies is emptied rather than removed — the answers keep the
 * parent they were written under, and the thread still reads as one. One
 * without replies simply goes. Either way the content's count comes down, and a
 * reply also takes its thread's reply count down with it.
 *
 * Deleting an already-deleted comment is a no-op rather than an error, so a
 * retried request cannot decrement a counter twice.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const commentId = pathParam(event, 'commentId');

  const comment = await requireCommentModerator(contentId, commentId, userId);
  if (comment.deletedAt) return noContent();

  if (comment.replyCount > 0) {
    await tombstoneComment(contentId, commentId);
  } else {
    await deleteCommentItem(contentId, commentId);
  }

  await addContentCounters(contentId, { commentCount: -1 });
  if (comment.parentId) {
    await addCommentCounters(contentId, comment.parentId, { replyCount: -1 });
  }

  return noContent();
}

export const handler = handle(main);
