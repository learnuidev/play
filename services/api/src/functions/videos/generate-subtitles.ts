import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LanguageCode } from '@aws-sdk/client-transcribe';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { env } from '../../lib/config';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { deletePrefix } from '../../lib/s3';
import { startTranscriptionJob } from '../../lib/transcribe';

/**
 * On-demand subtitle generation. Clears any previous subtitle output,
 * marks the video's subtitles GENERATING, and submits a Transcribe job.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await requireVideoAccess(videoId, userId, 'write');
  if (video.subtitleStatus === 'GENERATING') {
    throw new HttpError(409, 'Subtitles are already being generated');
  }

  // Only the raw upload is required; transcription runs off the source file.
  if (!video.s3Key) {
    throw new HttpError(409, 'Original upload is missing; upload the file again');
  }

  const languageCode = env.subtitleLanguage as LanguageCode;

  // Clear prior subtitle output so a fresh job starts clean.
  await deletePrefix(`subtitles/${videoId}/`);
  await updateVideo(videoId, {
    subtitleStatus: 'GENERATING',
    subtitleKey: undefined,
    subtitleLanguage: languageCode,
    translations: null,
  });

  try {
    await startTranscriptionJob({
      videoId,
      inputUrl: `s3://${env.bucket}/${video.s3Key}`,
      languageCode,
    });
  } catch (err) {
    console.error(`Failed to start subtitle generation for videoId=${videoId}`, err);
    await updateVideo(videoId, { subtitleStatus: 'FAILED' });
    throw new HttpError(500, 'Failed to start subtitle generation');
  }

  const updated = await getVideo(videoId);
  return ok({ video: updated }, 202);
}

export const handler = handle(main);
