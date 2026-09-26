import { parseTimestamp } from './vtt';
import type { SubtitleCue, TranscriptWord } from '@/types';

/**
 * A transcript built for reading along: one line per cue, and inside it a token
 * per word, each carrying the stretch of time it is spoken over.
 *
 * Cues alone are not enough to animate a transcript. A cue says "these words
 * are on screen from 12.4s to 15.1s"; it does not say which word arrives when,
 * so a cue-by-cue fill would smear the whole line at once. Real word timings —
 * which Transcribe reports and the API passes on — make the fill land on the
 * word being said. When a video has none, the line's words are spread across
 * the cue in proportion to their length, which is wrong by a few hundred
 * milliseconds and still far better than nothing.
 */

/** One word, or the whitespace between two of them. */
export interface TranscriptToken {
  key: string;
  text: string;
  /** Start in milliseconds. */
  start: number;
  /** End in milliseconds. */
  end: number;
  /** Whitespace carries no glyph, so it is never animated — only laid out. */
  isSpace?: boolean;
}

export interface TranscriptLine {
  key: string;
  /** The line as plain text, for search and for aria. */
  text: string;
  start: number;
  end: number;
  tokens: TranscriptToken[];
}

/** VTT allows inline markup (`<v Speaker>`, `<i>`); it is not part of the words. */
const INLINE_TAG = /<[^>]*>/g;

function cleanCueText(text: string): string {
  return text.replace(INLINE_TAG, '').replace(/\s+/g, ' ').trim();
}

/**
 * Splits a line into words and the whitespace between them.
 *
 * Whitespace is kept as tokens rather than dropped so that the line is laid out
 * by the browser exactly as it reads — re-joining words with a single space
 * would quietly lose the double spaces and the punctuation-adjacent ones.
 */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part !== '');
}

/**
 * The words a line says, found by which line each word *starts* in.
 *
 * Overlap is the wrong test here: a word that begins before a line's boundary
 * and is still being said after it belongs to the line it began in, and
 * counting it against both lines would make both of them mismatch their text
 * and fall back to spreading. Assigning by start gives every word exactly one
 * line, which is what makes the pairing below a fair test.
 */
function wordsInCue(words: TranscriptWord[], start: number, end: number, isLast: boolean): TranscriptWord[] {
  return words.filter((word) => word.s >= start && (isLast ? word.s <= end : word.s < end));
}

/** A word's own timing, narrowed to the line that displays it. */
function clamped(word: TranscriptWord, start: number, end: number): { start: number; end: number } {
  const wordStart = Math.max(word.s, start);
  // Clamped at the end as well, so a word that runs past its line finishes
  // filling exactly as the line changes rather than snapping to full.
  const wordEnd = Math.min(Math.max(word.e, wordStart), end);
  return { start: wordStart, end: wordEnd };
}

/**
 * Spreads a cue's duration across its words by how long each one is.
 *
 * A length-weighted share is a crude stand-in for real timings, but it is the
 * right kind of crude: longer words take longer to say, so the fill tracks the
 * speech instead of drifting away from it mid-sentence.
 */
function interpolate(cueStart: number, cueEnd: number, wordTexts: string[]): { start: number; end: number }[] {
  const weights = wordTexts.map((text) => Math.max(text.length, 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(cueEnd - cueStart, 1);

  let cursor = cueStart;
  return weights.map((weight) => {
    const start = cursor;
    const end = start + (weight / total) * duration;
    cursor = end;
    return { start, end };
  });
}

/** Every cue, timed, in the order it is spoken. */
function timedCues(cues: SubtitleCue[]): { text: string; start: number; end: number }[] {
  const timed: { text: string; start: number; end: number }[] = [];

  for (const cue of cues) {
    const start = parseTimestamp(cue.start);
    const end = parseTimestamp(cue.end);
    const text = cleanCueText(cue.text);
    if (start === null || end === null || !text || end <= start) continue;
    timed.push({ text, start, end });
  }

  return timed.sort((a, b) => a.start - b.start);
}

export function buildTranscriptLines(cues: SubtitleCue[], words?: TranscriptWord[]): TranscriptLine[] {
  const timed = timedCues(cues);
  if (timed.length === 0) return [];

  // Word timings arrive in the order they were spoken, but a transcript that
  // has been edited in place can put a cue before the words inside it, so the
  // window search below assumes nothing about order.
  const timedWords = words ?? [];

  return timed.map((cue, index) => {
    const parts = tokenize(cue.text);
    const wordTexts = parts.filter((part) => !/^\s+$/.test(part));

    const within = timedWords.length
      ? wordsInCue(timedWords, cue.start, cue.end, index === timed.length - 1)
      : [];

    // Word timings are used only when they describe this line exactly. A cue
    // whose text has been edited since it was transcribed no longer matches its
    // words, and a mismatched pairing would animate the wrong ones — spreading
    // the cue instead keeps the fill honest about what it knows.
    const timings =
      within.length === wordTexts.length
        ? within.map((word) => clamped(word, cue.start, cue.end))
        : interpolate(cue.start, cue.end, wordTexts);

    let wordIndex = 0;
    const tokens: TranscriptToken[] = parts.map((part, partIndex) => {
      const key = `${index}-${partIndex}`;
      if (/^\s+$/.test(part)) {
        return { key, text: part, start: cue.start, end: cue.start, isSpace: true };
      }

      const timing = timings[wordIndex] ?? { start: cue.start, end: cue.end };
      wordIndex += 1;
      return { key, text: part, start: timing.start, end: timing.end };
    });

    return { key: `line-${index}`, text: cue.text, start: cue.start, end: cue.end, tokens };
  });
}

/**
 * A pause at least this long between two lines starts a new paragraph.
 *
 * Paragraphs are not in the subtitle file — a caption file breaks text where it
 * fits on screen, not where a speaker paused — so they are inferred from the
 * one thing a transcript does record: silence.
 */
export const PARAGRAPH_GAP_MS = 2000;

export interface TranscriptParagraph {
  key: string;
  /** Where each of its lines sits in the flat transcript, in order. */
  indices: number[];
}

/**
 * Collects lines into paragraphs, in one pass over the transcript.
 *
 * A line joins the paragraph above it unless the speaker stopped for longer
 * than `gapMs`, which is what turns a wall of captions into something that
 * reads like the talk it came from.
 */
export function groupIntoParagraphs(
  lines: TranscriptLine[],
  gapMs: number = PARAGRAPH_GAP_MS,
): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];

  lines.forEach((line, index) => {
    const current = paragraphs[paragraphs.length - 1];
    const previous = current ? lines[current.indices[current.indices.length - 1]] : undefined;

    if (current && previous && line.start - previous.end <= gapMs) {
      current.indices.push(index);
      return;
    }

    paragraphs.push({ key: `p-${index}`, indices: [index] });
  });

  return paragraphs;
}

/**
 * The line being read at a moment: the one that started most recently, or -1
 * before the first line begins.
 *
 * Deliberately not "the line whose start and end bracket the playhead". A
 * transcript is full of silences — between sentences, between paragraphs — and
 * a bracketing test reports *nothing* being read for the length of every one of
 * them: the sheet stops following, the fill stalls mid-word, and both start
 * again a beat later. The line that started most recently survives the gaps,
 * which is what keeps the page moving like a page being read rather than a
 * caption being switched.
 *
 * Binary search rather than a scan: it runs once a frame, and a long transcript
 * is exactly where a linear scan would start to show.
 */
export function findActiveLine(lines: TranscriptLine[], timeMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;

    if (lines[middle].start <= timeMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}
