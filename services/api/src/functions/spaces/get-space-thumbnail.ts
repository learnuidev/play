import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';
import { buildSpaceThumbnailUrl } from '../../lib/space-thumbnail';

/** Returns a signed CloudFront URL for the space's cover image, if it has one. */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = event.pathParameters?.spaceId;

  if (!spaceId) throw new HttpError(400, 'spaceId path parameter is required');

  const space = await requireSpaceAccess(spaceId, userId, 'read');

  if (!space.thumbnailKey) {
    throw new HttpError(404, 'No thumbnail for this space');
  }

  return ok(
    await buildSpaceThumbnailUrl({ spaceId: space.spaceId, thumbnailKey: space.thumbnailKey }),
  );
}

export const handler = handle(main);
