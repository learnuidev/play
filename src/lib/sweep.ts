/**
 * The sweep: one frame of a word-by-word transcript animation.
 *
 * A `requestAnimationFrame` loop measures how far the playhead has travelled
 * through one word and writes two custom properties onto its element:
 *
 *   `--p`   how much of the word is sung through (0 → 1), which paints the fill
 *   `--pop` the swell of the word being sung right now (0 → 1)
 *
 * The CSS that turns those two numbers into a gradient fill, a lift and a glow
 * lives in `globals.css`; the tuning lives here. Nothing about this goes
 * through React: at 60 frames a second, re-rendering a line to move a fill
 * front would spend the whole frame budget on reconciliation.
 */

/** Progress is quantised to this many steps, so a still word writes nothing. */
export const SWEEP_STEPS = 400;
/** The swell eases in slowly and out even more slowly, so it never snaps back. */
const SWEEP_POP_APPROACH = 0.085;
const SWEEP_POP_RELEASE = 0.055;
/** Below this the swell counts as zero and the composited layer is released. */
const SWEEP_POP_FLOOR = 0.004;
/** ...and the value written to `--pop` is rounded this finely. */
const SWEEP_POP_STEPS = 100;

/** One word of one line, with how far the playhead has swept through it. */
export interface SweepTarget {
  el: HTMLElement;
  /** 0 → not yet said, 1 → fully said, anything between is mid-fill. */
  progress: number;
}

/**
 * Per-word bookkeeping. The arrays are allocated once per line — never per
 * frame — and every write is guarded by a comparison against the last value,
 * because a redundant `style.setProperty` across a few hundred words is exactly
 * what makes a transcript stutter.
 */
export interface SweepRuntime {
  /** The eased swell, carried between frames. */
  pop: Float32Array;
  lastProgress: Float32Array;
  lastPop: Float32Array;
}

export function createSweepRuntime(count: number): SweepRuntime {
  return {
    pop: new Float32Array(count),
    // -1 rather than 0: the first frame must write even at rest, so a word that
    // was animated before always lands in a clean state.
    lastProgress: new Float32Array(count).fill(-1),
    lastPop: new Float32Array(count).fill(-1),
  };
}

/**
 * Writes one frame of the sweep for every target.
 *
 * The swell is deliberately asymmetric: about 250ms to build while a word is
 * being said and slower to release, so the word you are on never snaps back the
 * moment it is finished.
 *
 * Nothing here promotes anything to a compositor layer. It used to raise
 * `will-change` on whichever word was moving, which is one layer built and torn
 * down per word — a compositor commit each time, for a lift of three quarters of
 * a pixel. The fill is cheap to paint where it is: it is the *rest* of the sheet
 * that had to stop being expensive (see `globals.css`).
 */
export function applySweepFrame(targets: SweepTarget[], runtime: SweepRuntime): void {
  for (let index = 0; index < targets.length; index += 1) {
    const { el, progress } = targets[index];

    const roundedProgress = Math.round(progress * SWEEP_STEPS) / SWEEP_STEPS;
    if (roundedProgress !== runtime.lastProgress[index]) {
      runtime.lastProgress[index] = roundedProgress;
      el.style.setProperty('--p', `${roundedProgress}`);
    }

    const popTarget = progress > 0 && progress < 1 ? 1 : 0;
    const approach = popTarget > runtime.pop[index] ? SWEEP_POP_APPROACH : SWEEP_POP_RELEASE;
    runtime.pop[index] += (popTarget - runtime.pop[index]) * approach;

    const pop = runtime.pop[index] < SWEEP_POP_FLOOR ? 0 : runtime.pop[index];
    const roundedPop = Math.round(pop * SWEEP_POP_STEPS) / SWEEP_POP_STEPS;
    if (roundedPop !== runtime.lastPop[index]) {
      runtime.lastPop[index] = roundedPop;
      el.style.setProperty('--pop', `${roundedPop}`);
    }
  }
}

/** How far the playhead has swept through one timed word. */
export function getSweepProgress(time: number, start: number, end: number): number {
  if (time <= start) return 0;
  if (time >= end) return 1;
  if (end <= start) return 1;
  return (time - start) / (end - start);
}
