import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { listLoops } from '../../lib/loops';

/**
 * The caller's own loops on a lesson, oldest first.
 *
 * Only ever their own: the partition is the learner's id, so there is no version
 * of this query that returns somebody else's study aids. Nobody else needs to
 * see them, and nobody else can.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'read');

  return ok({ loops: await listLoops(userId, contentId) });
}

export const handler = handle(main);
