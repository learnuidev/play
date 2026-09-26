import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { MIN_LOOP_MS, loopKey, putLoop, toApiLoop } from '../../lib/loops';
import { parseLoopName, parseLoopRange } from '../../lib/validation';
import type { ContentLoop } from '../../types';

/** `#rrggbb` only, so the UI can put it straight into a CSS custom property. */
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

interface CreateLoopBody {
  name?: unknown;
  color?: unknown;
  startMs?: unknown;
  endMs?: unknown;
}

/**
 * Saves a stretch of a lesson as a named loop.
 *
 * Reading the lesson is all this needs: a loop is the learner's own study aid,
 * like a bookmark, not an editorial act — so a viewer may keep loops on
 * everything they can watch.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'read');

  const body = jsonBody<CreateLoopBody>(event);
  const name = parseLoopName(body.name);
  const range = parseLoopRange(body.startMs, body.endMs, MIN_LOOP_MS);

  const color = typeof body.color === 'string' ? body.color.trim() : '';
  if (color && !COLOR_PATTERN.test(color)) {
    throw new HttpError(400, 'color must be a hex colour like #6366f1');
  }

  const loopId = ulid();
  const now = Date.now();

  const loop: ContentLoop = {
    userId,
    loopKey: loopKey(contentId, loopId),
    contentId,
    loopId,
    name,
    ...(color ? { color: color.toLowerCase() } : {}),
    ...range,
    likeCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await putLoop(loop);

  // Nobody likes their own loop twice: a loop you just made has no likes yet.
  return ok({ loop: toApiLoop(loop, false) }, 201);
}

export const handler = handle(main);
