import type { S3Event } from 'aws-lambda';
import { env } from '../../lib/config';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { startMediaConvertJob } from '../../lib/mediaconvert';
import { startTranscriptionJob } from '../../lib/transcribe';
import type { LanguageCode } from '@aws-sdk/client-transcribe';

function decodeKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

/**
 * Triggered by S3 `s3:ObjectCreated:*` on the `uploads/` prefix.
 * Marks the video as PROCESSING, submits an AWS Elemental MediaConvert
 * job that transcodes the raw upload into an HLS adaptive-bitrate ladder,
 * and kicks off AWS Transcribe subtitle generation in parallel.
 */
export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records ?? []) {
    const key = decodeKey(record.s3.object.key);
    if (!key.startsWith('uploads/')) continue;

    const videoId = key.split('/')[1];
    if (!videoId) continue;

    try {
      const video = await getVideo(videoId);
      if (!video) {
        console.warn(`No metadata record for videoId=${videoId}, skipping`);
        continue;
      }
      if (video.status !== 'UPLOADING' && video.status !== 'PROCESSING') {
        console.info(`Video ${videoId} already in ${video.status} state, skipping`);
        continue;
      }

      await updateVideo(videoId, {
        status: 'PROCESSING',
        size: record.s3.object.size ?? video.size,
      });

      await startMediaConvertJob({
        videoId,
        inputUrl: `s3://${env.bucket}/${key}`,
        outputBase: `s3://${env.bucket}/processed/${videoId}/hls/`,
      });

      // Subtitle generation is best-effort and runs in parallel with encoding;
      // a transcription failure never fails the video itself.
      await updateVideo(videoId, {
        subtitleStatus: 'GENERATING',
        subtitleLanguage: env.subtitleLanguage,
      });
      try {
        await startTranscriptionJob({
          videoId,
          inputUrl: `s3://${env.bucket}/${key}`,
          languageCode: env.subtitleLanguage as LanguageCode,
        });
      } catch (subtitleErr) {
        console.error(`Failed to start subtitle generation for videoId=${videoId}`, subtitleErr);
        await updateVideo(videoId, { subtitleStatus: 'FAILED' });
      }
    } catch (err) {
      console.error(`Failed to start processing for videoId=${videoId}`, err);
      await updateVideo(videoId, { status: 'FAILED' });
    }
  }
};
