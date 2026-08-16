import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { env } from '../../lib/config';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { startMediaConvertJob } from '../../lib/mediaconvert';
import { deletePrefix, listKeysUnderPrefix } from '../../lib/s3';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');
  if (video.status !== 'FAILED') {
    throw new HttpError(409, `Cannot retry processing while the video is ${video.status}`);
  }

  const uploadKeys = await listKeysUnderPrefix(`uploads/${videoId}/`);
  if (uploadKeys.length === 0) {
    throw new HttpError(409, 'Original upload is missing; upload the file again');
  }

  // Clear any partial transcoded output from the previous attempt so the
  // new job starts clean and the completion handler picks the fresh manifest.
  await deletePrefix(`processed/${videoId}/`);

  await updateVideo(videoId, { status: 'PROCESSING' });

  try {
    await startMediaConvertJob({
      videoId,
      inputUrl: `s3://${env.bucket}/${video.s3Key}`,
      outputBase: `s3://${env.bucket}/processed/${videoId}/hls/`,
    });
  } catch (err) {
    console.error(`Failed to retry processing for videoId=${videoId}`, err);
    await updateVideo(videoId, { status: 'FAILED' });
    throw new HttpError(500, 'Failed to start processing job');
  }

  const updated = await getVideo(videoId);
  return ok({ video: updated });
}

export const handler = handle(main);
