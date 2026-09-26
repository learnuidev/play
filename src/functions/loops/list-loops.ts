import type { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { listLoopsByContent, toApiLoop } from '../../lib/loops';
import { favouriteTargetKey, listFavouriteTargets } from '../../lib/favourites';

/**
 * The loops on a lesson, oldest first — everybody's, not only the caller's.
 *
 * A loop is a passage somebody thought worth hearing again, which is exactly the
 * kind of thing worth passing on: they are shared with the course, and each one
 * says who made it. What the caller has liked travels with them, so the list can
 * be drawn without a second request per row.
 */
async function main(event: APIGatewayEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'read');

  const [loops, liked] = await Promise.all([
    listLoopsByContent(contentId),
    listFavouriteTargets(userId, 'LOOP'),
  ]);

  return ok({ loops: loops.map((loop) => toApiLoop(loop, liked.has(loop.loopId))) });
}

export const handler = handle(main);
