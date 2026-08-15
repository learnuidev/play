import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { buildSignedStreamUrl } from '../../lib/cloudfront';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');

  if (video.status !== 'READY' || !video.manifestKey) {
    throw new HttpError(409, `Video is not ready to stream (status: ${video.status})`);
  }

  const stream = buildSignedStreamUrl(video.manifestKey);
  return ok({ ...stream, videoId });
}

export const handler = handle(main);
