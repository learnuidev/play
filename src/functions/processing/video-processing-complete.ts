import type { EventBridgeEvent } from 'aws-lambda';
import { updateVideo } from '../../lib/dynamodb';
import { getObjectText, listKeysUnderPrefix } from '../../lib/s3';
import { findThumbnailKey } from '../../lib/thumbnail';

interface MediaConvertDetail {
  status: 'COMPLETE' | 'ERROR' | 'CANCELED' | string;
  userMetadata?: { videoId?: string; inputUrl?: string; type?: string };
}

type MediaConvertStateChangeEvent = EventBridgeEvent<'MediaConvert Job State Change', MediaConvertDetail>;

/**
 * Finds the HLS master playlist produced by MediaConvert. The master
 * playlist is the `.m3u8` file that references variants via
 * `#EXT-X-STREAM-INF` (as opposed to media playlists which contain
 * `#EXT-X-MEDIA-SEQUENCE`).
 */
async function findMasterPlaylistKey(videoId: string): Promise<string | undefined> {
  const prefix = `processed/${videoId}/hls/`;
  const keys = (await listKeysUnderPrefix(prefix)).filter((k) => k.endsWith('.m3u8'));

  for (const key of keys) {
    const content = await getObjectText(key);
    if (content.includes('#EXT-X-STREAM-INF')) return key;
  }
  return keys[0];
}

async function handleEncodingComplete(videoId: string): Promise<void> {
  const [manifestKey, thumbnailKey] = await Promise.all([
    findMasterPlaylistKey(videoId),
    findThumbnailKey(videoId),
  ]);
  await updateVideo(videoId, {
    status: 'READY',
    ...(manifestKey ? { manifestKey } : {}),
    ...(thumbnailKey ? { thumbnailKey, thumbnailStatus: 'READY' } : {}),
  });
  console.info(
    `Video ${videoId} is READY (manifest: ${manifestKey ?? 'unknown'}, thumbnail: ${thumbnailKey ?? 'unknown'})`,
  );
}

async function handleThumbnailComplete(videoId: string): Promise<void> {
  const thumbnailKey = await findThumbnailKey(videoId);
  await updateVideo(videoId, {
    ...(thumbnailKey ? { thumbnailKey, thumbnailStatus: 'READY' } : { thumbnailStatus: 'FAILED' }),
  });
  console.info(`Thumbnail ${thumbnailKey ?? 'missing'} for video ${videoId}`);
}

/**
 * Triggered by CloudWatch Events on MediaConvert job state change. Handles
 * both the main encoding job (marks the video READY/FAILED and stores the
 * manifest + thumbnail keys) and standalone thumbnail jobs.
 */
export const handler = async (event: MediaConvertStateChangeEvent): Promise<void> => {
  const { status, userMetadata } = event.detail ?? {};
  const videoId = userMetadata?.videoId;

  if (!videoId) {
    console.info('Ignoring MediaConvert event without a videoId');
    return;
  }

  const isThumbnailJob = userMetadata?.type === 'thumbnail';

  if (isThumbnailJob) {
    if (status === 'COMPLETE') {
      await handleThumbnailComplete(videoId);
    } else {
      await updateVideo(videoId, { thumbnailStatus: 'FAILED' });
      console.warn(`Thumbnail generation for video ${videoId} ${status}`);
    }
    return;
  }

  if (status === 'COMPLETE') {
    await handleEncodingComplete(videoId);
  } else {
    await updateVideo(videoId, { status: 'FAILED', thumbnailStatus: 'FAILED' });
    console.warn(`Video ${videoId} processing ${status}`);
  }
};
