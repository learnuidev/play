import type { EventBridgeEvent } from 'aws-lambda';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { getObjectText, listKeysUnderPrefix } from '../../lib/s3';
import { findCapturedThumbnail, isCustomThumbnail } from '../../lib/thumbnail';

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
    audioStatus: audioKey ? 'READY' : 'FAILED',
    ...(audioKey ? { audioKey } : {}),
  });
  console.info(`Video ${videoId} is READY (manifest: ${manifestKey ?? 'unknown'}, audio: ${audioKey ?? 'unknown'})`);
}

/** Handles completion of an audio-only extraction job (type === 'audio'). */
async function handleAudioComplete(videoId: string): Promise<void> {
  const audioKey = await findAudioKey(videoId);
  await updateVideo(videoId, {
    audioStatus: audioKey ? 'READY' : 'FAILED',
    ...(audioKey ? { audioKey } : {}),
  });
  console.info(`Audio extraction for ${videoId} completed (audio: ${audioKey ?? 'unknown'})`);
}

/**
 * Handles completion of a first-frame thumbnail job (type === 'frame').
 * Stores the captured frame as the video's default thumbnail, unless the user
 * has uploaded a custom image in the meantime — a custom thumbnail always wins.
 */
async function handleThumbnailComplete(videoId: string): Promise<void> {
  const video = await getVideo(videoId);
  if (!video) {
    console.warn(`No metadata record for videoId=${videoId}, skipping thumbnail`);
    return;
  }
  if (isCustomThumbnail(video.thumbnailKey)) {
    console.info(`Video ${videoId} has a custom thumbnail, keeping it`);
    return;
  }

  const thumbnailKey = await findCapturedThumbnail(videoId);
  if (!thumbnailKey) {
    console.warn(`No captured frame found for videoId=${videoId}`);
    return;
  }

  await updateVideo(videoId, { thumbnailKey });
  console.info(`Default thumbnail for ${videoId} set from first frame (${thumbnailKey})`);
}

/**
 * Triggered by CloudWatch Events on MediaConvert job state change. Marks the
 * video READY/FAILED and stores the HLS manifest key, or (for audio-only
 * extraction jobs) just stores the extracted audio key.
 */
export const handler = async (event: MediaConvertStateChangeEvent): Promise<void> => {
  const { status, userMetadata } = event.detail ?? {};
  const videoId = userMetadata?.videoId;

  if (!videoId) {
    console.info('Ignoring MediaConvert event without a videoId');
    return;
  }

  if (userMetadata?.type === 'audio') {
    if (status === 'COMPLETE') {
      await handleAudioComplete(videoId);
    } else {
      await updateVideo(videoId, { audioStatus: 'FAILED' });
      console.warn(`Audio extraction for ${videoId} ${status}`);
    }
    return;
  }

  if (userMetadata?.type === 'frame') {
    if (status === 'COMPLETE') {
      await handleThumbnailComplete(videoId);
    } else {
      // The video itself is unaffected; it just keeps its placeholder thumbnail.
      console.warn(`First-frame thumbnail for ${videoId} ${status}`);
    }
    return;
  }

  if (status === 'COMPLETE') {
    await handleEncodingComplete(videoId);
  } else {
    await updateVideo(videoId, { status: 'FAILED' });
    console.warn(`Video ${videoId} processing ${status}`);
  }
};
