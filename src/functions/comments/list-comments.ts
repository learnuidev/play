import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { assembleThreads, listComments } from '../../lib/comments';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * The discussion on a piece of content: every top-level comment with its
 * replies, oldest first.
 *
 * `MAX_THREAD_COMMENTS` is the ceiling on how much of it is read, and
 * `truncated` says when it was reached, so a client can say "showing the most
 * recent N" rather than quietly showing a partial conversation.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'read');

  const { comments, truncated } = await listComments(contentId);

  return ok({ threads: assembleThreads(comments), truncated });
}

export const handler = handle(main);
