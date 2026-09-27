import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { buildSignedStreamUrl } from '../../lib/cloudfront';
import { HttpError, handle, ok } from '../../lib/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await requireVideoAccess(videoId, userId, 'read');

  if (video.status !== 'READY' || !video.manifestKey) {
    throw new HttpError(409, `Video is not ready to stream (status: ${video.status})`);
  }

  const stream = await buildSignedStreamUrl(video.manifestKey);
  return ok({ ...stream, videoId });
}

export const handler = handle(main);
