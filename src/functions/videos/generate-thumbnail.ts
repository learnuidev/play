import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { env } from '../../lib/config';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { startThumbnailGeneration } from '../../lib/thumbnail';

/**
 * Regenerates a video's thumbnail by submitting a standalone MediaConvert
 * frame-capture job against the raw upload. Completion is applied
 * asynchronously by the MediaConvert state-change listener.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');
  if (video.thumbnailStatus === 'GENERATING') {
    throw new HttpError(409, 'Thumbnail is already being generated');
  }
  if (!video.s3Key) {
    throw new HttpError(409, 'Original upload is missing; upload the file again');
  }

  await updateVideo(videoId, { thumbnailStatus: 'GENERATING', thumbnailKey: undefined });

  try {
    await startThumbnailGeneration(videoId, `s3://${env.bucket}/${video.s3Key}`);
  } catch (err) {
    console.error(`Failed to start thumbnail generation for videoId=${videoId}`, err);
    await updateVideo(videoId, { thumbnailStatus: 'FAILED' });
    throw new HttpError(500, 'Failed to start thumbnail generation');
  }

  const updated = await getVideo(videoId);
  return ok({ video: updated }, 202);
}

export const handler = handle(main);
