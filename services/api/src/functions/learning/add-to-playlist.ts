import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { addToPlaylist } from '../../lib/playlist';

/**
 * Puts a piece of content in the caller's learning playlist.
 *
 * A playlist is private — what you mean to watch — so it needs only reading
 * access to the content, not write access to the organization. Adding twice is
 * a no-op for the same reason favouriting twice is.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'read');

  await addToPlaylist({ userId, contentId, addedAt: Date.now() });

  return ok({ inPlaylist: true });
}

export const handler = handle(main);
