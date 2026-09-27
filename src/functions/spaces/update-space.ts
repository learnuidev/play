import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseDripIntervalDays, parseStartAt } from '../../lib/space-schedule';
import { getSpace, updateSpace } from '../../lib/spaces';
import { SPACE_TYPES } from '../../types';
import type { SpaceType } from '../../types';

const MAX_DESCRIPTION_LENGTH = 500;

/** `#rrggbb` only: a value the UI can put straight into a CSS custom property. */
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

interface UpdateSpaceBody {
  title?: unknown;
  description?: unknown;
  type?: unknown;
  /** Empty string or `null` clears the accent colour. */
  color?: unknown;
  startAt?: unknown;
  dripIntervalDays?: unknown;
}

/**
 * Edits what a course says about itself.
 *
 * Every field is optional and only what is present is written, so the overview
 * form can save one thing without having to send the rest back — and a client
 * that sends the whole form twice cannot resurrect a value somebody else cleared
 * in between.
 *
 * The type is the one field with a consequence: a course becoming scheduled must
 * arrive with a start date, and one becoming self-paced has its schedule taken
 * off, because a self-paced course with a start date in it is a row that lies
 * about how it unlocks.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await requireSpaceAccess(spaceId, userId, 'write');
  const body = jsonBody<UpdateSpaceBody>(event);

  const patch: Parameters<typeof updateSpace>[1] = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') throw new HttpError(400, 'title must be a string');
    const title = body.title.trim().replace(/\s+/g, ' ');
    if (title.length < 2) throw new HttpError(400, 'title must be at least 2 characters');
    if (title.length > 80) throw new HttpError(400, 'title must be <= 80 characters');
    patch.title = title;
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      throw new HttpError(400, 'description must be a string');
    }
    const description = body.description.trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new HttpError(400, `description must be <= ${MAX_DESCRIPTION_LENGTH} characters`);
    }
    patch.description = description;
  }

  if (body.color !== undefined) {
    // An empty colour is how the form says "no colour": the space falls back to
    // the one derived from its id rather than storing an empty string.
    const color = typeof body.color === 'string' ? body.color.trim() : '';
    if (!color) patch.color = null;
    else {
      if (!COLOR_PATTERN.test(color)) {
        throw new HttpError(400, 'color must be a hex colour like #6366f1');
      }
      patch.color = color.toLowerCase();
    }
  }

  const type = body.type === undefined ? space.type : (body.type as SpaceType);
  if (body.type !== undefined) {
    if (typeof body.type !== 'string' || !SPACE_TYPES.includes(body.type as SpaceType)) {
      throw new HttpError(400, `type must be one of ${SPACE_TYPES.join(', ')}`);
    }
    patch.type = body.type as SpaceType;
  }

  if (type === 'SCHEDULED') {
    // The date may be the one already on the course: changing only the drip
    // cadence should not require re-sending the start date.
    const startAt =
      body.startAt === undefined ? space.startAt : parseStartAt(body.startAt as string | number);
    if (startAt === undefined) throw new HttpError(400, 'startAt is required for a scheduled space');

    patch.startAt = startAt;
    patch.dripIntervalDays =
      body.dripIntervalDays === undefined
        ? (space.dripIntervalDays ?? parseDripIntervalDays(undefined))
        : parseDripIntervalDays(body.dripIntervalDays as number);
  } else if (patch.type === 'SELF_PACED') {
    // Only when the mode actually changed: a self-paced course has no schedule
    // to remove, and writing a removal anyway would be a write nobody asked for.
    patch.startAt = null;
    patch.dripIntervalDays = null;
  }

  await updateSpace(spaceId, patch);

  const updated = await getSpace(spaceId);
  return ok({ space: updated });
}

export const handler = handle(main);
