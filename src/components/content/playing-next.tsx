'use client';

import { PlayIcon } from 'lucide-react';

/**
 * The next lesson, offered as this one ends.
 *
 * Netflix's shape and Netflix's reason: the countdown is drawn as well as
 * spoken, because a bar draining behind a number answers "how long have I got?"
 * without reading it. The card fades up from the corner it lives in — up and
 * in, never sideways — so it arrives at the edge of attention rather than in
 * front of the video.
 *
 * It is fixed to the page's bottom-left rather than tucked into the video's
 * corner: the video is only 70% of the width and the panel beside it is where a
 * reader's attention is for most of a lesson, so a notice drawn *inside* the
 * video is a notice half the time nobody sees. Dark, so it reads over whatever
 * it lands on.
 *
 * Both ways out are here. "Play now" for the impatient, "Cancel" for the reader
 * who is not finished, and the next lesson is only ever offered, never taken.
 */
export function PlayingNext({
  title,
  seconds,
  total,
  onPlayNow,
  onCancel,
}: {
  title: string;
  /** Whole seconds left. */
  seconds: number;
  /** What the countdown started from, for the bar's scale. */
  total: number;
  onPlayNow: () => void;
  onCancel: () => void;
}) {
  // The bar drains with the seconds rather than on a timer of its own, so it
  // cannot drift from the number printed beside it.
  const share = Math.max(0, Math.min(1, seconds / total));

  return (
    <div
      role="status"
      aria-live="polite"
      className="playing-next fixed bottom-6 left-6 z-50 w-[min(19rem,calc(100vw-3rem))] overflow-hidden rounded-xl bg-black/85 p-3.5 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
        Up next
      </p>
      <p className="mt-1 truncate text-sm font-medium">{title}</p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-white/70">Playing in {seconds}s</span>

        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPlayNow}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <PlayIcon className="size-3" />
            Play now
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-xs font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
        </span>
      </div>

      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
        <span
          className="play-next-bar block h-full bg-white transition-[width] duration-1000 ease-linear"
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </div>
  );
}
