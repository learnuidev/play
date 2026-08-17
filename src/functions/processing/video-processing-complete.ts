import type { EventBridgeEvent } from 'aws-lambda';
import { updateVideo } from '../../lib/dynamodb';
import { getObjectText, listKeysUnderPrefix } from '../../lib/s3';

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

/** Finds the standalone audio track produced by the audio-only output group. */
async function findAudioKey(videoId: string): Promise<string | undefined> {
  const prefix = `processed/${videoId}/audio/`;
  const keys = await listKeysUnderPrefix(prefix);
  return keys.find((k) => /\.(mp4|m4a)$/i.test(k)) ?? keys[0];
}

async function handleEncodingComplete(videoId: string): Promise<void> {
  const manifestKey = await findMasterPlaylistKey(videoId);
  const audioKey = await findAudioKey(videoId);
  await updateVideo(videoId, {
    status: 'READY',
    ...(manifestKey ? { manifestKey } : {}),
    ...(audioKey ? { audioKey } : {}),
  });
  console.info(`Video ${videoId} is READY (manifest: ${manifestKey ?? 'unknown'}, audio: ${audioKey ?? 'unknown'})`);
}

/**
 * Triggered by CloudWatch Events on MediaConvert job state change. Marks the
 * video READY/FAILED and stores the HLS manifest key.
 */
export const handler = async (event: MediaConvertStateChangeEvent): Promise<void> => {
  const { status, userMetadata } = event.detail ?? {};
  const videoId = userMetadata?.videoId;

  if (!videoId) {
    console.info('Ignoring MediaConvert event without a videoId');
    return;
  }

  if (status === 'COMPLETE') {
    await handleEncodingComplete(videoId);
  } else {
    await updateVideo(videoId, { status: 'FAILED' });
    console.warn(`Video ${videoId} processing ${status}`);
  }
};
