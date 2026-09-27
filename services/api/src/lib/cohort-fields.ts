import { HttpError } from './http';
import { parseStartAt } from './space-schedule';

/**
 * A cohort's own fields, validated in one place.
 *
 * Creating and editing a cohort are two routes onto the same four fields, and a
 * name that is too long or a run that ends before it begins must be refused the
 * same way on both.
 */

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

export function parseCohortName(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'name is required');

  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < MIN_NAME_LENGTH) {
    throw new HttpError(400, `name must be at least ${MIN_NAME_LENGTH} characters`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `name must be <= ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

export function parseCohortDescription(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new HttpError(400, 'description must be a string');

  const description = raw.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(400, `description must be <= ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  return description;
}

/**
 * A cohort's run: when it starts and when it ends.
 *
 * Both are optional — a cohort is a grouping first and a schedule second — but
 * they are checked as a pair when both are present, because a run that ends
 * before it begins is a typo rather than an arrangement. `null` is passed
 * through as "clear this date", which is how the edit route removes one.
 */
export function parseCohortDates(
  startRaw: unknown,
  endRaw: unknown,
): { startAt?: number | null; endAt?: number | null } {
  const startAt =
    startRaw === undefined || startRaw === null || startRaw === ''
      ? (startRaw === null || startRaw === '' ? null : undefined)
      : parseStartAt(startRaw as string | number);

  const endAt =
    endRaw === undefined || endRaw === null || endRaw === ''
      ? (endRaw === null || endRaw === '' ? null : undefined)
      : parseStartAt(endRaw as string | number);

  if (typeof startAt === 'number' && typeof endAt === 'number' && endAt < startAt) {
    throw new HttpError(400, 'endAt must be after startAt');
  }

  return { startAt, endAt };
}
