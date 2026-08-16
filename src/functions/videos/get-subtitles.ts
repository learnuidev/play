import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { buildSignedSubtitleUrl } from '../../lib/cloudfront';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { getObjectText } from '../../lib/s3';

/**
 * Returns a signed CloudFront URL for the video's WebVTT subtitle file, along
 * with the raw VTT content for the subtitle editor.
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

  const content = await getObjectText(video.subtitleKey);

  return ok({
    ...buildSignedSubtitleUrl(video.subtitleKey),
    videoId,
    content,
  });
}

export const handler = handle(main);
