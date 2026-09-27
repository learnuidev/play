import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
const RESOLUTION_TIERS = [2160, 1440, 1080, 720, 480, 360, 240, 144];

/** Maps a resolution to its nearest standard tier label (e.g. '1440p'). */
export function resolutionTierFor(width: number, height: number): string {
  const shortSide = Math.min(width, height);
  for (const tier of RESOLUTION_TIERS) {
    if (shortSide >= tier) return `${tier}p`;
  }
  return `${Math.max(1, Math.round(shortSide))}p`;
}

/** Formats a duration in seconds as m:ss or h:mm:ss. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Formats an epoch-millisecond timestamp as a plain calendar date.
 *
 * The date is rendered in UTC because that is what a space's start date was
 * stored as: a scheduled space starts on a day, not at an instant, and reading
 * it back in the viewer's zone would shift it a day for anyone west of UTC.
 */
export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
}
