import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireOrganizationAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';
import { putSpace } from '../../lib/spaces';
import { DEFAULT_DRIP_INTERVAL_DAYS, SPACE_TYPES } from '../../types';
import type { Space, SpaceType } from '../../types';

const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MIN_DRIP_INTERVAL_DAYS = 1;
const MAX_DRIP_INTERVAL_DAYS = 365;

/** `#rrggbb` only: a value the UI can put straight into a CSS custom property. */
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** A date-only string, which is what an `<input type="date">` submits. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface CreateSpaceBody {
  title?: string;
  description?: string;
  type?: string;
  color?: string;
  startAt?: number | string;
  dripIntervalDays?: number;
}

/**
 * Accepts epoch milliseconds or an ISO date/date-time. A date-only value is
 * pinned to UTC midnight rather than the server's local midnight, so the day a
 * scheduled space starts does not depend on where the Lambda runs.
 */
function parseStartAt(value: number | string | undefined): number {
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

function parseDripIntervalDays(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DRIP_INTERVAL_DAYS;
  if (!Number.isInteger(value) || value < MIN_DRIP_INTERVAL_DAYS || value > MAX_DRIP_INTERVAL_DAYS) {
    throw new HttpError(
      400,
      `dripIntervalDays must be a whole number between ${MIN_DRIP_INTERVAL_DAYS} and ${MAX_DRIP_INTERVAL_DAYS}`,
    );
  }
  return value;
}

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = event.pathParameters?.orgId;

  if (!orgId) throw new HttpError(400, 'orgId path parameter is required');

  // Only admins and editors may add to an organization; viewers are read-only.
  await requireOrganizationAccess(user.userId, orgId, 'write');

  let body: CreateSpaceBody = {};
  try {
    body = (event.body ? JSON.parse(event.body) : {}) as CreateSpaceBody;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }

  const title = (body.title ?? '').trim().replace(/\s+/g, ' ');
  const description = (body.description ?? '').trim();
  const type = (body.type ?? '') as SpaceType;
  const color = (body.color ?? '').trim();

  if (!title) throw new HttpError(400, 'title is required');
  if (title.length < MIN_TITLE_LENGTH) {
    throw new HttpError(400, `title must be at least ${MIN_TITLE_LENGTH} characters`);
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new HttpError(400, `title must be <= ${MAX_TITLE_LENGTH} characters`);
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(400, `description must be <= ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  if (!SPACE_TYPES.includes(type)) {
    throw new HttpError(400, `type must be one of ${SPACE_TYPES.join(', ')}`);
  }
  if (color && !COLOR_PATTERN.test(color)) {
    throw new HttpError(400, 'color must be a hex colour like #6366f1');
  }

  const spaceId = ulid();
  const now = Date.now();

  const space: Space = {
    spaceId,
    organizationId: orgId,
    title,
    description,
    type,
    ...(color ? { color: color.toLowerCase() } : {}),
    // Self-paced spaces carry no schedule at all: their clock is each member's
    // enrollment, so a start date or a drip cadence would only be a second,
    // contradictory source of truth.
    ...(type === 'SCHEDULED'
      ? {
          startAt: parseStartAt(body.startAt),
          dripIntervalDays: parseDripIntervalDays(body.dripIntervalDays),
        }
      : {}),
    createdBy: user.userId,
    createdAt: now,
    updatedAt: now,
  };

  await putSpace(space);

  return ok({ space }, 201);
}

export const handler = handle(main);
