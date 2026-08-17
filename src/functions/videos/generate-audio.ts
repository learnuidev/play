import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { env } from '../../lib/config';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { startAudioExtractionJob } from '../../lib/mediaconvert';

/**
 * On-demand audio extraction. Submits a MediaConvert job that produces only
 * the audio track from the raw upload (no video ladder), for videos that are
 * READY but have no audio — e.g. videos uploaded before audio extraction
 * existed, or whose audio extraction previously failed.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');
  if (video.status !== 'READY') {
    throw new HttpError(409, `Cannot extract audio while the video is ${video.status}`);
  }
  if (video.audioStatus === 'GENERATING') {
    throw new HttpError(409, 'Audio extraction is already in progress');
  }
  if (!video.s3Key) {
    throw new HttpError(409, 'Original upload is missing; upload the file again');
  }

  await updateVideo(videoId, { audioStatus: 'GENERATING' });

  try {
    await startAudioExtractionJob({
      videoId,
      inputUrl: `s3://${env.bucket}/${video.s3Key}`,
      outputBase: `s3://${env.bucket}/processed/${videoId}/audio/`,
    });
  } catch (err) {
    console.error(`Failed to start audio extraction for videoId=${videoId}`, err);
    await updateVideo(videoId, { audioStatus: 'FAILED' });
    throw new HttpError(500, 'Failed to start audio extraction');
  }

  const updated = await getVideo(videoId);
  return ok({ video: updated }, 202);
}

export const handler = handle(main);
