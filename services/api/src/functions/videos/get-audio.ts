import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { buildSignedAudioUrl } from '../../lib/cloudfront';
import { HttpError, handle, ok } from '../../lib/http';

/**
 * Returns a signed CloudFront URL for the video's extracted audio track,
 * scoped to `processed/{videoId}/audio/*` so it can be played standalone.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await requireVideoAccess(videoId, userId, 'read');

  if (video.status !== 'READY' || !video.audioKey) {
    throw new HttpError(409, `Audio is not ready (status: ${video.status})`);
  }

  return ok({ ...(await buildSignedAudioUrl(video.audioKey)), videoId });
}

export const handler = handle(main);
