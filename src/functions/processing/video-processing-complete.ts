import type { EventBridgeEvent } from 'aws-lambda';
import { updateVideo } from '../../lib/dynamodb';
import { getObjectText, listKeysUnderPrefix } from '../../lib/s3';

interface MediaConvertDetail {
  status: 'COMPLETE' | 'ERROR' | 'CANCELED' | string;
  userMetadata?: { videoId?: string; inputUrl?: string };
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

/**
 * Triggered by CloudWatch Events on MediaConvert job state change.
 * Marks the video READY (and stores the manifest key) or FAILED.
 */
export const handler = async (event: MediaConvertStateChangeEvent): Promise<void> => {
  const { status, userMetadata } = event.detail ?? {};
  const videoId = userMetadata?.videoId;

  if (!videoId) {
    console.info('Ignoring MediaConvert event without a videoId');
    return;
  }

  if (status === 'COMPLETE') {
    const manifestKey = await findMasterPlaylistKey(videoId);
    await updateVideo(videoId, {
      status: 'READY',
      ...(manifestKey ? { manifestKey } : {}),
    });
    console.info(`Video ${videoId} is READY (manifest: ${manifestKey ?? 'unknown'})`);
  } else {
    await updateVideo(videoId, { status: 'FAILED' });
    console.warn(`Video ${videoId} processing ${status}`);
  }
};
