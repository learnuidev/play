import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { deleteVideoItem } from '../../lib/dynamodb';
import { HttpError, handle, noContent } from '../../lib/http';
import { deletePrefix } from '../../lib/s3';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await requireVideoAccess(videoId, userId, 'write');
  if (video.status === 'PROCESSING') {
    throw new HttpError(409, 'Cannot delete a video while it is encoding');
  }

  await deletePrefix(`uploads/${videoId}/`);
  await deletePrefix(`processed/${videoId}/`);
  await deletePrefix(`subtitles/${videoId}/`);
  await deletePrefix(`thumbnails/${videoId}/`);
  await deleteVideoItem(videoId);

  return noContent();
}

export const handler = handle(main);
