import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { buildSignedAudioUrl } from '../../lib/cloudfront';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';

/**
 * Returns a signed CloudFront URL for the video's extracted audio track,
 * scoped to `processed/{videoId}/audio/*` so it can be played standalone.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');

  if (video.status !== 'READY' || !video.audioKey) {
    throw new HttpError(409, `Audio is not ready (status: ${video.status})`);
  }

  return ok({ ...buildSignedAudioUrl(video.audioKey), videoId });
}

export const handler = handle(main);
