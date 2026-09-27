import type { SubtitleCue } from '@play/types';

/**
 * Parses a WebVTT timestamp ("MM:SS.mmm" or "HH:MM:SS.mmm", comma or dot as
 * the millisecond separator) into milliseconds, or returns null if invalid.
 */
export function parseTimestamp(input: string): number | null {
  const match = input.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!match) return null;

  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, '0'));

  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** Formats milliseconds as an "HH:MM:SS.mmm" WebVTT timestamp. */
export function formatTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

let cueCounter = 0;
function nextId(): string {
  cueCounter += 1;
  return `cue-${Date.now().toString(36)}-${cueCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parses a WebVTT document into editable cues. Handles the WEBVTT header,
 * optional header metadata, cue identifiers, and NOTE/STYLE/REGION blocks.
 */
export function parseVtt(content: string): SubtitleCue[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const cues: SubtitleCue[] = [];

  let i = 0;
  if (lines[0]?.trim().startsWith('WEBVTT')) {
    i = 1;
    // Skip header metadata lines until the blank line that ends the header.
    while (i < lines.length && lines[i].trim() !== '') i += 1;
    i += 1; // past the blank line
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Skip NOTE/STYLE/REGION blocks (everything until the next blank line).
    if (/^(NOTE|STYLE|REGION)\b/i.test(line.trim())) {
      while (i < lines.length && lines[i].trim() !== '') i += 1;
      continue;
    }

    // Collect the block: [id?] timing-line [text lines...].
    const block: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      block.push(lines[i]);
      i += 1;
    }

    const timingIndex = block.findIndex((l) => l.includes('-->'));
    if (timingIndex === -1) continue;

    const [start, ...rest] = block[timingIndex].split('-->');
    const end = (rest.join('-->').trim().split(/\s+/)[0] ?? '').trim();
    const text = block.slice(timingIndex + 1).join('\n').trim();

    if (!start || !end || !text) continue;

    cues.push({
      id: nextId(),
      start: start.trim(),
      end,
      text,
    });
  }

  return cues;
}

/**
 * Where a *single-line* caption is anchored, as a percentage of the video
 * height.
 *
 * A cue's `line` percentage positions the cue box by its **top** edge, and the
 * box then grows downward. That is why a long cue used to get cut off: the
 * first line landed at 90% and every line after it fell past the bottom of the
 * frame. Chrome also ignores the `end` line alignment (`line:90%,end` renders
 * exactly like `line:90%`), so the box cannot simply be bottom-anchored.
 *
 * The fix is to lift the anchor one line per extra line, so the *last* line of
 * the block stays where a single line would have been; see
 * `cueLinePercent`.
 */
export const CUE_BASE_LINE_PERCENT = 90;

/**
 * Height of one caption line, as a percentage of the video height. Chrome
 * renders cue text at 5% of the video height with the usual 1.2 line height,
 * which measures at ~6% per line.
 */
export const CUE_LINE_PITCH_PERCENT = 6;

/** Longest caption line we emit before wrapping the rest onto the next line. */
export const MAX_CUE_LINE_CHARS = 42;

/** Number of rendered lines in a (already wrapped) cue text. */
export function cueLineCount(text: string): number {
  return text.split('\n').length;
}

/**
 * The `line` percentage that keeps a caption's bottom edge in the same place
 * no matter how many lines it wraps onto: 90% for one line, 84% for two, 78%
 * for three, and so on. Extra lines therefore grow *upward* into the frame
 * instead of being cut off at the bottom.
 */
export function cueLinePercent(lineCount: number): number {
  return CUE_BASE_LINE_PERCENT - CUE_LINE_PITCH_PERCENT * Math.max(0, lineCount - 1);
}

/**
 * How many characters fit on one caption line at this video size. Chrome lays
 * cue text out at 5% of the video height, so a 16:9 player fits ~75 characters.
 * Stay under that (and under the broadcast limit) so a line we wrap ourselves
 * is never wrapped *again* by the renderer, which would break the line count
 * the anchor is derived from.
 */
export function captionCharsPerLine(
  videoWidth: number,
  videoHeight: number,
  maxChars = MAX_CUE_LINE_CHARS,
): number {
  if (!videoWidth || !videoHeight) return maxChars;
  const fits = Math.floor(36 * (videoWidth / videoHeight));
  return Math.max(16, Math.min(maxChars, fits));
}

/**
 * Serializes cues into a canonical WebVTT document, wrapping over-long text
 * onto the next line and anchoring each cue so the whole block stays inside
 * the video frame.
 */
export function serializeVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map((cue) => {
      const text = wrapCueText(cue.text);
      return `${cue.start.trim()} --> ${cue.end.trim()} line:${cueLinePercent(cueLineCount(text))}%\n${text}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/**
 * Splits `line` into the fewest lines that each fit within `maxChars`, then
 * nudges words down so the wrap doesn't end on a stub tail line (e.g.
 * "The quick brown fox jumps over the / lazy dog and runs away" instead of
 * "...the lazy dog / and runs away").
 *
 * A single token longer than `maxChars` (a long URL, or languages written
 * without spaces) is left intact and left to the renderer — breaking it mid
 * word would be worse than letting the browser wrap it.
 */
function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [line];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);

  // Move words from the second-to-last line down while the tail line is still
  // under half a line, keeping every line within `maxChars` and never emptying
  // the line we're borrowing from.
  let tail = lines.length - 1;
  while (tail > 0 && lines[tail].length * 2 < maxChars) {
    const previous = lines[tail - 1].split(' ');
    if (previous.length < 2) break;
    const moved = previous[previous.length - 1];
    if (lines[tail].length + 1 + moved.length > maxChars) break;
    lines[tail - 1] = previous.slice(0, -1).join(' ');
    lines[tail] = `${moved} ${lines[tail]}`;
  }

  return lines;
}

/**
 * Wraps a cue's text so no line runs past the video frame. Breaks the author
 * (or Transcribe) already put in the cue are kept; only lines that are too
 * long are split, which makes this idempotent.
 */
export function wrapCueText(text: string, maxChars = MAX_CUE_LINE_CHARS): string {
  return text
    .split('\n')
    .flatMap((line) => wrapLine(line.trim(), maxChars))
    .join('\n');
}
