import type { SubtitleCue } from '@/types';

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
 * Vertical anchor for every caption block, as a percentage of the video
 * height. The cue box is anchored by its *bottom* edge (`line:90%,end`) so a
 * caption that wraps onto extra lines grows upward into the frame instead of
 * running past the bottom edge and being cut off.
 */
export const CUE_BOTTOM_PERCENT = 90;

/** Longest caption line we emit before wrapping the rest onto the next line. */
export const MAX_CUE_LINE_CHARS = 42;

/** Serializes cues into a canonical WebVTT document. */
export function serializeVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${cue.start.trim()} --> ${cue.end.trim()} line:${CUE_BOTTOM_PERCENT}%,end\n${cue.text}`,
    )
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
