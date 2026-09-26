import { getObjectText, putObjectText } from './s3';
import type { TranscriptWord } from '../types';

/**
 * Word-level timings, kept beside the subtitle they belong to.
 *
 * AWS Transcribe writes both a WebVTT file (cues: a line of text with a start
 * and an end) and a JSON transcript (every word with its own start and end).
 * The subtitle is what a player needs; the words are what an *animated*
 * transcript needs, because "which word is being said right now" cannot be
 * recovered from a cue's boundaries — only from the words themselves.
 *
 * The JSON is written by the same job that writes the VTT, so this is a read of
 * an artifact that already exists rather than a second transcription.
 */

/** How many words are read back to a client. Two hours of speech is ~20k. */
export const MAX_TRANSCRIPT_WORDS = 20_000;

/** Where a video's word timings live. */
export function transcriptWordsKey(videoId: string): string {
  return `subtitles/${videoId}/words.json`;
}

/** The words below this are noise from Transcribe's own tokenisation. */
const FILLER = new Set(['', ' ', '\n']);

interface TranscribeItem {
  type?: string;
  start_time?: string;
  end_time?: string;
  alternatives?: { content?: string; confidence?: string }[];
}

interface TranscribeDocument {
  results?: { items?: TranscribeItem[] };
}

/** Seconds as a string, as Transcribe writes them, into milliseconds. */
function toMillis(seconds: string | undefined): number | undefined {
  if (seconds === undefined) return undefined;
  const value = Number(seconds);
  return Number.isFinite(value) ? Math.round(value * 1000) : undefined;
}

/**
 * Reads the words out of a Transcribe JSON transcript.
 *
 * Pronunciation items carry the timings; punctuation items carry none, so each
 * mark is appended to the word before it — which is how the subtitle text reads
 * ("Hello," rather than "Hello" and a stray comma), and what lets the words be
 * laid against that text one for one.
 */
export function parseTranscribeWords(document: unknown): TranscriptWord[] {
  const items = (document as TranscribeDocument)?.results?.items;
  if (!Array.isArray(items)) return [];

  const words: TranscriptWord[] = [];

  for (const item of items) {
    const content = item?.alternatives?.[0]?.content ?? '';

    if (item?.type === 'punctuation') {
      const last = words[words.length - 1];
      // Punctuation with nothing before it has nothing to belong to.
      if (last) last.w += content;
      continue;
    }

    if (item?.type !== 'pronunciation') continue;

    const start = toMillis(item.start_time);
    const end = toMillis(item.end_time);
    const word = content.trim();
    if (start === undefined || end === undefined) continue;
    if (FILLER.has(word)) continue;
    // A zero-length word cannot be swept through, and would stall the playhead
    // arithmetic of the line it sits on.
    if (end <= start) continue;

    words.push({ w: word, s: start, e: end });
  }

  return words;
}

/**
 * Turns the JSON transcript of a completed job into the word timings a client
 * can fetch. Returns how many words were kept.
 */
export async function writeTranscriptWords(videoId: string, transcriptJsonKey: string): Promise<number> {
  const raw = await getObjectText(transcriptJsonKey);

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new Error(`Transcript at ${transcriptJsonKey} is not valid JSON`);
  }

  const words = parseTranscribeWords(document);
  if (words.length === 0) return 0;

  // Stored without whitespace: this is a payload a client fetches and parses,
  // not a file anyone reads.
  await putObjectText(transcriptWordsKey(videoId), JSON.stringify(words), 'application/json');
  return words.length;
}

/**
 * A video's word timings, or nothing when it has none — a video transcribed
 * before this existed still has an animated transcript, it just falls back to
 * spreading each cue's duration across its words.
 */
export async function readTranscriptWords(videoId: string): Promise<TranscriptWord[] | undefined> {
  let raw: string;
  try {
    raw = await getObjectText(transcriptWordsKey(videoId));
  } catch {
    return undefined; // never written, or deleted with the rest of the video's output
  }

  try {
    const parsed = JSON.parse(raw) as TranscriptWord[];
    return Array.isArray(parsed) && parsed.length ? parsed : undefined;
  } catch {
    return undefined;
  }
}
