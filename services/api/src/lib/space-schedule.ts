import { HttpError } from './http';
import { DEFAULT_DRIP_INTERVAL_DAYS } from '../types';

/**
 * The two fields that make a space scheduled, validated in one place.
 *
 * They live here rather than in the handler that first needed them because a
 * space's schedule is written twice — once when it is created, once when its
 * details are edited — and the two routes must agree about what a valid date is
 * down to the timezone.
 */

const MIN_DRIP_INTERVAL_DAYS = 1;
const MAX_DRIP_INTERVAL_DAYS = 365;

/** A date-only string, which is what an `<input type="date">` submits. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts epoch milliseconds or an ISO date/date-time. A date-only value is
 * pinned to UTC midnight rather than the server's local midnight, so the day a
 * scheduled space starts does not depend on where the Lambda runs.
 */
export function parseStartAt(value: number | string | undefined): number {
  if (value === undefined || value === null || value === '') {
    throw new HttpError(400, 'startAt is required for a scheduled space');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HttpError(400, 'startAt must be a valid date');
    return value;
  }

  const trimmed = value.trim();
  const parsed = Date.parse(DATE_ONLY_PATTERN.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, 'startAt must be an ISO date or epoch milliseconds');
  }
  return parsed;
}

export function parseDripIntervalDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DRIP_INTERVAL_DAYS;
  if (!Number.isInteger(value) || value < MIN_DRIP_INTERVAL_DAYS || value > MAX_DRIP_INTERVAL_DAYS) {
    throw new HttpError(
      400,
      `dripIntervalDays must be a whole number between ${MIN_DRIP_INTERVAL_DAYS} and ${MAX_DRIP_INTERVAL_DAYS}`,
    );
  }
  return value;
}

/** The bounds, for a form that would rather fail before it round-trips. */
export const DRIP_INTERVAL_BOUNDS = {
  min: MIN_DRIP_INTERVAL_DAYS,
  max: MAX_DRIP_INTERVAL_DAYS,
};
