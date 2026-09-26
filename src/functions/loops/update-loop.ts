import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { MIN_LOOP_MS, getLoop, updateLoop, type UpdateLoopPatch } from '../../lib/loops';
import { parseLoopName, parseLoopRange } from '../../lib/validation';

/** `#rrggbb` only, so the UI can put it straight into a CSS custom property. */
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

interface UpdateLoopBody {
  name?: unknown;
  color?: unknown;
  startMs?: unknown;
  endMs?: unknown;
}

/**
 * Renames a loop, recolours it, or moves where it starts and ends.
 *
 * Each field stands alone, so renaming does not have to restate the boundaries
 * — but the boundaries are checked together whichever one is sent, because the
 * only thing that makes a loop a loop is that it has two ends in the right
 * order. Moving one end is therefore still a request that names both.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const loopId = pathParam(event, 'loopId');

  await requireContentAccess(contentId, userId, 'read');

  const existing = await getLoop(userId, contentId, loopId);
  if (!existing) throw new HttpError(404, 'Loop not found');

  const body = jsonBody<UpdateLoopBody>(event);
  const patch: UpdateLoopPatch = {};

  if (body.name !== undefined) patch.name = parseLoopName(body.name);

  if (body.color !== undefined) {
    const color = typeof body.color === 'string' ? body.color.trim() : '';
    if (color && !COLOR_PATTERN.test(color)) {
      throw new HttpError(400, 'color must be a hex colour like #6366f1');
    }
    patch.color = color.toLowerCase();
  }

  if (body.startMs !== undefined || body.endMs !== undefined) {
    // Whichever end was not sent is the one already stored: a request that moves
    // the start does not have to repeat an end it is not touching.
    const range = parseLoopRange(
      body.startMs ?? existing.startMs,
      body.endMs ?? existing.endMs,
      MIN_LOOP_MS,
    );
    patch.startMs = range.startMs;
    patch.endMs = range.endMs;
  }

  if (Object.keys(patch).length === 0) return ok({ loop: existing });

  await updateLoop(userId, contentId, loopId, patch);

  const updated = await getLoop(userId, contentId, loopId);
  return ok({ loop: updated });
}

export const handler = handle(main);
