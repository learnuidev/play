import type { S3Event } from 'aws-lambda';
import { env } from '../../lib/config';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { startMediaConvertJob } from '../../lib/mediaconvert';

function decodeKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

/**
 * Triggered by S3 `s3:ObjectCreated:*` on the `uploads/` prefix.
 * Marks the video as PROCESSING and submits an AWS Elemental MediaConvert
 * job that transcodes the raw upload into an HLS adaptive-bitrate ladder.
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
    } catch (err) {
      console.error(`Failed to start processing for videoId=${videoId}`, err);
      await updateVideo(videoId, { status: 'FAILED' });
    }
  }
};
