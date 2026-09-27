import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCommentAuthor } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getComment, updateCommentBody } from '../../lib/comments';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseCommentBody } from '../../lib/validation';

interface UpdateCommentBody {
  body?: unknown;
}

/**
 * Edits what a comment says. Only its author may — an admin or editor can take
 * a comment down, but not put words in someone's mouth — and the edit is
 * stamped so a reader can see it was not the original.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const commentId = pathParam(event, 'commentId');

  const comment = await requireCommentAuthor(contentId, commentId, userId);
  if (comment.deletedAt) throw new HttpError(409, 'A deleted comment cannot be edited');

  const body = jsonBody<UpdateCommentBody>(event);

  await updateCommentBody(contentId, commentId, parseCommentBody(body.body));

  return ok({ comment: await getComment(contentId, commentId) });
}

export const handler = handle(main);
