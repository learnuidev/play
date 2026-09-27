'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long before the end the next lesson is offered.
 *
 * Long enough to read a title and decide, short enough that it is about the end
 * of the video rather than about watching it.
 */
export const PLAYING_NEXT_LEAD_SECONDS = 10;

const LEAD_MS = PLAYING_NEXT_LEAD_SECONDS * 1000;

/** Everything the countdown remembers between frames. */
export interface CountdownState {
  /** Whole seconds on screen, or null when there is nothing to show. */
  shown: number | null;
  /** When it runs out, in `performance.now()` terms. Null when not running. */
  deadline: number | null;
  cancelled: boolean;
  advanced: boolean;
}

export const IDLE_COUNTDOWN: CountdownState = {
  shown: null,
  deadline: null,
  cancelled: false,
  advanced: false,
};

export interface CountdownInput {
  /** `performance.now()`. */
  now: number;
  /** Milliseconds left in the video, or null when that is not known yet. */
  remainingMs: number | null;
  /** False when there is nothing to play next, or no video to play it from. */
  enabled: boolean;
}

/**
 * One frame of the countdown, as a step from one state to the next.
 *
 * Pure, and separate from the loop that drives it, because "when does it
 * appear, what does it say, does it fire" is the whole feature and it should be
 * possible to check it without a video.
 *
 * It counts down on a wall clock from the moment it appears, clamped by what is
 * left of the video — `min(deadline, remaining)`. Counting from the video's
 * position alone freezes the moment the reader pauses, which is a countdown
 * that never arrives; counting on the wall clock alone would run past the end
 * of a video the reader has seeked backwards in.
 */
export function stepCountdown(
  state: CountdownState,
  { now, remainingMs, enabled }: CountdownInput,
): { next: CountdownState; advance: boolean } {
  const hidden = { ...state, shown: null, deadline: null };

  if (!enabled || remainingMs === null) {
    return { next: hidden, advance: false };
  }

  // The video is over. This is the moment the countdown was counting down to,
  // and the end arrives between two frames — the position goes straight past
  // the end, it never lands exactly on it — so it is checked for here rather
  // than left to a deadline that has nothing left to wait for.
  if (remainingMs <= 0) {
    if (state.cancelled) return { next: { ...IDLE_COUNTDOWN }, advance: false };
    return {
      next: { ...state, shown: null, deadline: null, advanced: true },
      advance: !state.advanced,
    };
  }

  // Well before the end: nothing to show, and whatever the reader decided last
  // time is forgotten — a cancel is about one ending, not every ending.
  if (remainingMs > LEAD_MS * 2) {
    return { next: { ...IDLE_COUNTDOWN }, advance: false };
  }

  // In the lead, but declined, or not in it yet.
  if (state.cancelled || remainingMs > LEAD_MS) {
    return { next: hidden, advance: false };
  }

  const deadline = state.deadline ?? now + LEAD_MS;
  const left = Math.min(deadline - now, remainingMs);

  if (left <= 0) {
    return {
      next: { ...state, shown: null, deadline: null, advanced: true },
      advance: !state.advanced,
    };
  }

  // Ceiling, so the number on screen is the second the reader is in: "1" means
  // under a second, not "it says 1 and nothing is happening".
  return { next: { ...state, deadline, shown: Math.ceil(left / 1000) }, advance: false };
}

/**
 * The countdown to the next lesson, driven off the video's own position.
 *
 * Nothing here re-renders per frame: the loop runs at frame rate because that is
 * what reads the media position smoothly, but it only sets state when the whole
 * number of seconds changes, so a countdown costs about one render a second.
 */
export function usePlayingNext({
  getTimeMs,
  getDurationMs,
  enabled,
  onAdvance,
}: {
  getTimeMs: () => number;
  getDurationMs: () => number;
  enabled: boolean;
  onAdvance: () => void;
}) {
  const [seconds, setSeconds] = useState<number | null>(null);

  const stateRef = useRef<CountdownState>(IDLE_COUNTDOWN);
  const shownRef = useRef<number | null>(null);

  const onAdvanceRef = useRef(onAdvance);
  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    let frame = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);

      const duration = getDurationMs();
      const remainingMs = duration > 0 ? duration - getTimeMs() : null;

      const { next, advance } = stepCountdown(stateRef.current, { now, remainingMs, enabled });
      stateRef.current = next;

      if (next.shown !== shownRef.current) {
        shownRef.current = next.shown;
        setSeconds(next.shown);
      }

      if (advance) onAdvanceRef.current();
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, getDurationMs, getTimeMs]);

  const cancel = useCallback(() => {
    stateRef.current = { ...stateRef.current, cancelled: true, shown: null };
    shownRef.current = null;
    setSeconds(null);
  }, []);

  const playNow = useCallback(() => {
    if (stateRef.current.advanced) return;
    stateRef.current = { ...stateRef.current, advanced: true };
    onAdvanceRef.current();
  }, []);

  return { seconds, cancel, playNow, total: PLAYING_NEXT_LEAD_SECONDS };
}
