/**
 * The glide: how the sheet moves itself.
 *
 * The scroll position is not animated by the browser — a frame loop drives
 * `scrollTop` towards the line being read on a spring, which is what makes the
 * page *drift* to the next line instead of stepping to it. A spring is the
 * whole point: a CSS scroll animation restarts on every line change and reads
 * as a series of jumps, while a spring carries its velocity across them and
 * settles only when it has arrived.
 *
 * The tuning is here rather than in the component so the numbers that make it
 * feel like one continuous motion live together.
 */

/** Pull towards the target. */
const STIFFNESS = 90;
/** Damped to critical: settles crisply instead of bouncing past the line. */
const DAMPING = 19;
/** Whatever the spring asks for, the sheet never moves faster than this. */
const MAX_SPEED = 1400;

/** Below these the sheet counts as arrived and stops being written to. */
export const SETTLED_DISTANCE = 0.4;
export const SETTLED_VELOCITY = 8;

/**
 * How long manual scrolling wins before following takes over again — long
 * enough to read a passage by hand, short enough that the sheet is never left
 * stranded once you stop touching it.
 */
export const MANUAL_SCROLL_GRACE_MS = 4000;

/**
 * A jump is not a fast glide.
 *
 * Past this distance the sheet lands instead of travelling: a seek, or the
 * playhead leaving the sheet and coming back, would otherwise fly through
 * everything in between at the speed limit.
 */
const JUMP_FACTOR = 1.5;

export function isJump(error: number, stageHeight: number): boolean {
  return Math.abs(error) > stageHeight * JUMP_FACTOR;
}

/** Whether the spring has arrived. */
export function isSettled(error: number, velocity: number): boolean {
  return Math.abs(error) < SETTLED_DISTANCE && Math.abs(velocity) < SETTLED_VELOCITY;
}

/**
 * One frame of the spring, returning the new velocity.
 *
 * Sub-stepped at 120Hz: a frame can be a tenth of a second long after the
 * browser does anything else, and integrating a stiff spring over that in one
 * step overshoots the line it was heading for.
 */
export function glideVelocity(error: number, velocity: number, dt: number): number {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const step = dt / steps;

  let next = velocity;

  for (let index = 0; index < steps; index += 1) {
    const acceleration = error * STIFFNESS - next * DAMPING;
    next += acceleration * step;
    next = Math.max(Math.min(next, MAX_SPEED), -MAX_SPEED);
  }

  return next;
}
