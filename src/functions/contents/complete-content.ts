import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { completionKey, getCompletion, putCompletion } from '../../lib/completions';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * Marks a lesson done.
 *
 * Reading the lesson is all this needs: progress is the learner's own record of
 * what they have finished, not an editorial act and not an assessment — so any
 * member may keep it, and may as easily take it back.
 *
 * It is idempotent: marking something done twice is still done, and the moment
 * it was first finished is the one that is kept.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const content = await requireContentAccess(contentId, userId, 'read');

  const existing = await getCompletion(userId, content.spaceId, contentId);
  if (!existing) {
    await putCompletion({
      userId,
      spaceKey: completionKey(content.spaceId, contentId),
      spaceId: content.spaceId,
      contentId,
      completedAt: Date.now(),
    });
  }

  return ok({ completed: true, completedAt: existing?.completedAt ?? Date.now() });
}

export const handler = handle(main);
