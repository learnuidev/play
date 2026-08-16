import type { EventBridgeEvent } from 'aws-lambda';
import { updateVideo } from '../../lib/dynamodb';
import { deleteObjects, getObjectText, listKeysUnderPrefix, putObjectText } from '../../lib/s3';
import { normalizeVtt } from '../../lib/vtt';

interface TranscribeDetail {
  TranscriptionJobName?: string;
  TranscriptionJobStatus?: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'QUEUED' | string;
}

type TranscribeStateChangeEvent = EventBridgeEvent<'Transcribe Job State Change', TranscribeDetail>;

// Transcribe job names are `play-{videoId}-{timestamp}`, where videoId is a
// UUID v4 (randomUUID). Extract it to map the job back to a video record.
const VIDEO_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function findSubtitleKey(videoId: string): Promise<string | undefined> {
  const prefix = `subtitles/${videoId}/source/`;
  const keys = await listKeysUnderPrefix(prefix);
  return keys.find((k) => k.endsWith('.vtt'));
}

/**
 * Transcribe emits plain cues with no positioning, which the browser renders
 * at `line:auto` (drifting up/down per cue). Rewrite the file with a fixed
 * `line` setting and a fresh key so the player serves positioned captions.
 */
async function normalizeSourceSubtitle(videoId: string, sourceKey: string): Promise<string> {
  const content = await getObjectText(sourceKey);
  const normalized = normalizeVtt(content);
  const key = `subtitles/${videoId}/source/subtitles-${Date.now()}.vtt`;
  await putObjectText(key, normalized, 'text/vtt');
  if (key !== sourceKey) await deleteObjects([sourceKey]);
  return key;
}

/**
 * Triggered by CloudWatch Events on AWS Transcribe job state change.
 * Marks the video's subtitles READY (storing the VTT key) or FAILED.
 */
export const handler = async (event: TranscribeStateChangeEvent): Promise<void> => {
  const { TranscriptionJobName, TranscriptionJobStatus } = event.detail ?? {};

  if (!TranscriptionJobName) {
    console.info('Ignoring Transcribe event without a job name');
    return;
  }

  const videoId = TranscriptionJobName.match(VIDEO_ID_PATTERN)?.[0];
  if (!videoId) {
    console.info(`Ignoring Transcribe event with unparseable job name: ${TranscriptionJobName}`);
    return;
  }

  if (TranscriptionJobStatus === 'COMPLETED') {
    const sourceKey = await findSubtitleKey(videoId);
    let subtitleKey: string | undefined;

    if (sourceKey) {
      try {
        subtitleKey = await normalizeSourceSubtitle(videoId, sourceKey);
      } catch (err) {
        console.error(`Failed to normalize subtitles for videoId=${videoId}`, err);
        subtitleKey = sourceKey; // fall back to the raw Transcribe file
      }
    }

    await updateVideo(videoId, {
      subtitleStatus: subtitleKey ? 'READY' : 'FAILED',
      ...(subtitleKey ? { subtitleKey } : {}),
    });
    console.info(`Subtitles ${subtitleKey ? 'READY' : 'FAILED (no VTT found)'} for video ${videoId}`);
  } else if (TranscriptionJobStatus === 'FAILED') {
    await updateVideo(videoId, { subtitleStatus: 'FAILED' });
    console.warn(`Subtitle generation FAILED for video ${videoId}`);
  } else {
    console.info(`Ignoring Transcribe ${TranscriptionJobStatus} event for video ${videoId}`);
  }
};
