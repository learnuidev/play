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

/** Serializes cues into a canonical WebVTT document. */
export function serializeVtt(cues: VttCue[]): string {
  const body = cues
    .map((cue) => `${cue.start.trim()} --> ${cue.end.trim()}\n${cue.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}
