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
 * Cue settings applied to every cue so captions render at a consistent
 * vertical position (native WebVTT defaults to `line:auto`, which drifts up
 * and down depending on cue height and the current track).
 *
 * The `end` line alignment anchors the cue box by its *bottom* edge: a caption
 * that wraps onto extra lines grows upward into the frame, instead of a
 * top-anchored box running past the bottom edge with the extra lines cut off.
 */
const CUE_SETTINGS = 'line:90%,end';

/** Serializes cues into a canonical WebVTT document. */
export function serializeVtt(cues: VttCue[]): string {
  const body = cues
    .map((cue) => `${cue.start.trim()} --> ${cue.end.trim()} ${CUE_SETTINGS}\n${cue.text}`)
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
