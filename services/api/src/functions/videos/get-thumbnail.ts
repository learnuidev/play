import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';
import { buildThumbnailSignedUrl } from '../../lib/thumbnail';

/**
 * Returns a signed CloudFront URL for the video's current thumbnail (the
 * auto-generated poster frame or a custom upload).
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await requireVideoAccess(videoId, userId, 'read');

  if (!video.thumbnailKey) {
    throw new HttpError(404, 'No thumbnail for this video');
  }

  return ok(await buildThumbnailSignedUrl(video.thumbnailKey));
}

export const handler = handle(main);
