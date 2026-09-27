import type { EventBridgeEvent } from 'aws-lambda';
import { updateVideo } from '../../lib/dynamodb';
import { deleteObjects, getObjectText, listKeysUnderPrefix, putObjectText } from '../../lib/s3';
import { writeTranscriptWords } from '../../lib/transcript-words';
import { normalizeVtt } from '../../lib/vtt';

interface TranscribeDetail {
  TranscriptionJobName?: string;
  TranscriptionJobStatus?: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'QUEUED' | string;
}

type TranscribeStateChangeEvent = EventBridgeEvent<'Transcribe Job State Change', TranscribeDetail>;

// Transcribe job names are `play-{videoId}-{timestamp}` (see lib/transcribe.ts).
// Parse between the prefix and the trailing millisecond timestamp rather than
// matching an id shape, so both the UUIDs of videos uploaded before ULIDs and
// the ULIDs used now resolve — a UUID's hyphens and a ULID's length would each
// defeat a pattern that tried to describe the id itself.
const JOB_NAME_PATTERN = /^play-(.+)-(\d+)$/;

async function findSubtitleKey(videoId: string): Promise<string | undefined> {
  const prefix = `subtitles/${videoId}/source/`;
  const keys = await listKeysUnderPrefix(prefix);
  return keys.find((k) => k.endsWith('.vtt'));
}

/**
 * Transcribe writes its JSON transcript beside the VTT it writes, into the same
 * output prefix. It holds the word-level timings the VTT does not, so it is
 * kept as an artifact of its own rather than discarded.
 */
async function findTranscriptJsonKey(videoId: string): Promise<string | undefined> {
  const keys = await listKeysUnderPrefix(`subtitles/${videoId}/source/`);
  return keys.find((k) => k.endsWith('.json'));
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

  const videoId = TranscriptionJobName.match(JOB_NAME_PATTERN)?.[1];
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

    // Word timings are a bonus, not a requirement: a video whose transcript is
    // missing them still gets an animated transcript, spread across each cue
    // rather than placed word by word. So a failure here is logged, never fatal.
    try {
      const transcriptKey = await findTranscriptJsonKey(videoId);
      if (transcriptKey) {
        const count = await writeTranscriptWords(videoId, transcriptKey);
        console.info(`Stored ${count} word timings for video ${videoId}`);
      } else {
        console.info(`No JSON transcript found for video ${videoId}; word timings unavailable`);
      }
    } catch (err) {
      console.error(`Failed to store word timings for videoId=${videoId}`, err);
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
