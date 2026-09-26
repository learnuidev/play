import { LOOP_COLORS } from '@/types';

/**
 * The colour a loop is drawn in: its own if it was given one, otherwise one
 * derived from its id.
 *
 * Derived rather than defaulted matters as much here as it does for spaces — a
 * list of loops all in the same grey tells you nothing, while a stable colour
 * per id lets you recognise one at a glance in the list and on the track, and
 * keeps the same colour every time the page is opened.
 */
export function loopColor(loop: { loopId: string; color?: string }): string {
  if (loop.color) return loop.color;

  let hash = 0;
  for (let i = 0; i < loop.loopId.length; i += 1) {
    hash = (hash * 31 + loop.loopId.charCodeAt(i)) % 1_000_003;
  }
  return LOOP_COLORS[hash % LOOP_COLORS.length];
}
