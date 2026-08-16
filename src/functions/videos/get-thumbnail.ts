import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { buildThumbnailSignedUrl } from '../../lib/thumbnail';

/**
 * Returns a signed CloudFront URL for the video's current thumbnail (the
 * auto-generated poster frame or a custom upload).
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');

  if (!video.thumbnailKey) {
    throw new HttpError(404, 'No thumbnail for this video');
  }

  return ok(buildThumbnailSignedUrl(video.thumbnailKey));
}

export const handler = handle(main);
