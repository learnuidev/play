import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { deleteCompletion } from '../../lib/completions';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * Takes a lesson back off the done list.
 *
 * No error when there was nothing to remove: a learner pressing it twice, or on
 * a lesson they never marked, has asked for the same state either way.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const content = await requireContentAccess(contentId, userId, 'read');
  await deleteCompletion(userId, content.spaceId, contentId);

  return ok({ completed: false });
}

export const handler = handle(main);
