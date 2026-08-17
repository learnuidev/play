function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

/** Reduces a width/height pair to a display aspect ratio like '16:9'. */
export function computeAspectRatio(width: number, height: number): string {
  const g = gcd(width, height);
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

/** Standard short-side tiers, largest first. */
const TIERS = [2160, 1440, 1080, 720, 480, 360, 240, 144];

/** Maps a resolution to its nearest standard tier label (e.g. '1440p'). */
export function resolutionTierFor(width: number, height: number): string {
  const shortSide = Math.min(width, height);
  for (const tier of TIERS) {
    if (shortSide >= tier) return `${tier}p`;
  }
  return `${Math.max(1, Math.round(shortSide))}p`;
}

/** Short side (min dimension) of a resolution. */
export function shortSide(width: number, height: number): number {
  return Math.min(width, height);
}
