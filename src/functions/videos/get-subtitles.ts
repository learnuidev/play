import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { buildSignedSubtitleUrl } from '../../lib/cloudfront';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';

/**
 * Returns a signed CloudFront URL for the video's WebVTT subtitle file.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');

  if (video.subtitleStatus !== 'READY' || !video.subtitleKey) {
    throw new HttpError(409, `Subtitles are not ready (status: ${video.subtitleStatus ?? 'NONE'})`);
  }

  return ok({ ...buildSignedSubtitleUrl(video.subtitleKey), videoId });
}

export const handler = handle(main);
