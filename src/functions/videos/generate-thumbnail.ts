import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { env } from '../../lib/config';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { startFrameCaptureJob } from '../../lib/mediaconvert';
import { isCustomThumbnail } from '../../lib/thumbnail';

/**
 * Backfills the default thumbnail — the video's first frame — for videos that
 * were processed before it existed, or whose frame capture failed. Submits a
 * MediaConvert job that captures a single frame from the raw upload; the job
 * completion handler stores it as the video's thumbnail.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');
  if (video.status !== 'READY') {
    throw new HttpError(409, `Cannot capture a thumbnail while the video is ${video.status}`);
  }
  if (isCustomThumbnail(video.thumbnailKey)) {
    throw new HttpError(409, 'This video already has a custom thumbnail');
  }
  if (!video.s3Key) {
    throw new HttpError(409, 'Original upload is missing; upload the file again');
  }

  try {
    await startFrameCaptureJob({
      videoId,
      inputUrl: `s3://${env.bucket}/${video.s3Key}`,
      outputBase: `s3://${env.bucket}/thumbnails/${videoId}/`,
    });
  } catch (err) {
    console.error(`Failed to start thumbnail capture for videoId=${videoId}`, err);
    throw new HttpError(500, 'Failed to start thumbnail capture');
  }

  const updated = await getVideo(videoId);
  return ok({ video: updated }, 202);
}

export const handler = handle(main);
