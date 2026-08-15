import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { deleteVideoItem, getVideo } from '../../lib/dynamodb';
import { HttpError, handle, noContent } from '../../lib/http';
import { deletePrefix } from '../../lib/s3';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');
  if (video.status === 'PROCESSING') {
    throw new HttpError(409, 'Cannot delete a video while it is encoding');
  }

  await deletePrefix(`uploads/${videoId}/`);
  await deletePrefix(`processed/${videoId}/`);
  await deleteVideoItem(videoId);

  return noContent();
}

export const handler = handle(main);
