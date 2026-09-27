import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { removeFromPlaylist } from '../../lib/playlist';

/** Takes a piece of content out of the caller's learning playlist. */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'read');

  await removeFromPlaylist(userId, contentId);

  return ok({ inPlaylist: false });
}

export const handler = handle(main);
