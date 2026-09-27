import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';
import { deleteLoopItem, getLoop } from '../../lib/loops';

/** Throws a loop away. Addressed through its owner, so only its owner can. */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const loopId = pathParam(event, 'loopId');

  await requireContentAccess(contentId, userId, 'read');

  const existing = await getLoop(userId, contentId, loopId);
  if (!existing) throw new HttpError(404, 'Loop not found');

  await deleteLoopItem(userId, contentId, loopId);

  return noContent();
}

export const handler = handle(main);
