import { formatDuration } from './utils';

/**
 * A moment in the video, as somebody writes it into a sentence.
 *
 * `@` and then a time: `@1:12`, `@01:12`, `@00:01:12`, and a fraction of a
 * second after any of them. The `@` is what tells a moment from a figure — a
 * discussion about a lesson is full of times, and "we shot this at 12:30" is a
 * sentence about the day, not a place in the video. Only the ones somebody
 * marked are meant as a pointer.
 *
 * Two parts are minutes and seconds, three are hours, minutes and seconds, so
 * that what is written and what the chip reads back are the same clock.
 *
 * The whole thing is one capture group on purpose: the parts of a sentence are
 * cut out of it by splitting on this pattern, and `split` only keeps what a
 * group captured.
 */
export const TIMECODE_PATTERN =
  /(@(?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:\.\d{1,3})?(?![\d:]))/g;

/**
 * The moment a timecode names, in milliseconds, or null when it names none.
 *
 * What the pattern let through but no clock has — `@70:00`, a seventieth
 * minute — is refused rather than repaired: a chip that seeks somewhere nobody
 * asked for is worse than a time left as the words it was written in.
 */
export function parseTimecode(raw: string): number | null {
  const match = raw
    .trim()
    .match(/^@(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;

  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = match[4] ? Number(match[4].padEnd(3, '0')) : 0;

  if (minutes > 59 || seconds > 59) return null;

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** How a moment reads on a chip: `0:00`, `1:12`, or `1:02:03` past an hour. */
export function timecodeLabel(ms: number): string {
  // `formatDuration` draws a dash for nothing, which is right for a duration
  // nobody knows and wrong for the first frame of the video — a place somebody
  // can be sent to.
  return ms <= 0 ? '0:00' : formatDuration(ms / 1000);
}
