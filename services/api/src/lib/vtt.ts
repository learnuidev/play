export interface VttCue {
  start: string;
  end: string;
  text: string;
}

/**
 * Parses a WebVTT document into cues. Handles the WEBVTT header, optional
 * header metadata, and NOTE/STYLE/REGION blocks. Timestamps are kept as
 * strings (parsing is only needed when translating/serializing).
 */
export function parseVtt(content: string): VttCue[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const cues: VttCue[] = [];

  let i = 0;
  if (lines[0]?.trim().startsWith('WEBVTT')) {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '') i += 1;
    i += 1; // past the blank line
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    if (/^(NOTE|STYLE|REGION)\b/i.test(line.trim())) {
      while (i < lines.length && lines[i].trim() !== '') i += 1;
      continue;
    }

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

    cues.push({ start: start.trim(), end, text });
  }

  return cues;
}

/**
 * Where a *single-line* caption is anchored, as a percentage of the video
 * height.
 *
 * A cue's `line` percentage positions the cue box by its **top** edge, and the
 * box grows downward — so a cue that wrapped onto extra lines ran past the
 * bottom of the video and got cut off. Chrome also ignores the `end` line
 * alignment, so the box can't simply be bottom-anchored; each cue's anchor is
 * instead lifted one line per extra line (see `cueLinePercent`), which keeps
 * the block's bottom edge where a single line would have been.
 */
const CUE_BASE_LINE_PERCENT = 90;

/** Chrome measures one caption line at ~6% of the video height. */
const CUE_LINE_PITCH_PERCENT = 6;

/** Longest caption line we emit before wrapping the rest onto the next line. */
export const MAX_CUE_LINE_CHARS = 42;

/** Number of rendered lines in a (already wrapped) cue text. */
function cueLineCount(text: string): number {
  return text.split('\n').length;
}

/** The `line` percentage that keeps this cue's block inside the frame. */
function cueLinePercent(lineCount: number): number {
  return CUE_BASE_LINE_PERCENT - CUE_LINE_PITCH_PERCENT * Math.max(0, lineCount - 1);
}

/**
 * Splits `line` into the fewest lines that each fit within `maxChars`, then
 * nudges words down so the wrap doesn't end on a stub tail line. A single token
 * longer than `maxChars` (a long URL, or languages written without spaces) is
 * left intact rather than broken mid-word.
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
 * (or Transcribe) already put in the cue are kept; only lines that are too long
 * are split, which makes this idempotent.
 */
export function wrapCueText(text: string, maxChars = MAX_CUE_LINE_CHARS): string {
  return text
    .split('\n')
    .flatMap((line) => wrapLine(line.trim(), maxChars))
    .join('\n');
}

/** Serializes cues into a canonical WebVTT document. */
export function serializeVtt(cues: VttCue[]): string {
  const body = cues
    .map((cue) => {
      const text = wrapCueText(cue.text);
      return `${cue.start.trim()} --> ${cue.end.trim()} line:${cueLinePercent(cueLineCount(text))}%\n${text}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/**
 * Re-parses and re-serializes a WebVTT document, applying consistent cue
 * positioning (used to normalize Transcribe's plain output).
 */
export function normalizeVtt(content: string): string {
  return serializeVtt(parseVtt(content));
}
