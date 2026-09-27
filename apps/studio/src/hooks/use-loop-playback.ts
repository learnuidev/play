'use client';

import { useEffect, useRef } from 'react';

/** How far outside a loop the playhead may stray before it is pulled back. */
const OUTSIDE_TOLERANCE_MS = 400;

/**
 * Plays a stretch of a lesson over and over.
 *
 * The player knows nothing about loops — it is a video element and a scrubber —
 * so the repeat is a frame loop that watches the playhead and puts it back at
 * the start when it leaves the end. That is also why the loop holds when the
 * reader scrubs *out* of it: a loop you can fall out of by touching the scrubber
 * is a loop that stops when you are least sure it will.
 *
 * Seeking is the only thing written, and only when the playhead is actually
 * outside the loop, so nothing here fights the player during normal playback.
 */
export function useLoopPlayback({
  loop,
  getTimeMs,
  seekTo,
  play,
}: {
  /** The loop to repeat, or null to play straight through. */
  loop: { startMs: number; endMs: number } | null;
  getTimeMs: () => number;
  seekTo: (timeMs: number) => void;
  /** Starts playback once the playhead is at the loop's beginning. */
  play?: () => void;
}) {
  const startMs = loop?.startMs ?? null;
  const endMs = loop?.endMs ?? null;

  // Taking a loop on means hearing it: the playhead goes to its beginning and
  // playback starts, because a loop that has been chosen but is sitting paused
  // at its own start has not been chosen at all.
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  }, [play]);

  useEffect(() => {
    if (startMs === null) return;
    seekTo(startMs);
    playRef.current?.();
  }, [startMs, seekTo]);

  useEffect(() => {
    if (startMs === null || endMs === null) return;

    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);

      const time = getTimeMs();

      const pastTheEnd = time >= endMs;
      const beforeTheStart = time < startMs - OUTSIDE_TOLERANCE_MS;

      if (pastTheEnd || beforeTheStart) seekTo(startMs);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startMs, endMs, getTimeMs, seekTo]);
}
