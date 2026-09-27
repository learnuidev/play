import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireRewardAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, decodedPathParam, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { deleteGrant, getGrant, setGrantStatus } from '../../lib/rewards';

interface RevokeGrantBody {
  /** Why it was taken back, kept on the row. */
  note?: unknown;
}

const MAX_NOTE_LENGTH = 500;

/**
 * Takes a reward back from a member.
 *
 * Two different acts, told apart by whether it was used:
 *
 * - An unused grant is **removed**. Issuing to the wrong person is a mistake, and
 *   a mistake is undone rather than annotated — the reward's counter goes back
 *   down with it, so the limit it is under stays honest.
 * - A redeemed grant is **revoked**, and the row stays. Something was handed over
 *   and used; the record of that is what a reward system exists to keep, and
 *   erasing it would make the books agree by deletion.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const rewardId = pathParam(event, 'rewardId');
  const memberId = decodedPathParam(event, 'userId');

  await requireRewardAccess(rewardId, userId, 'write');

  const grant = await getGrant(rewardId, memberId);
  if (!grant) throw new HttpError(404, 'This person does not hold this reward');

  const body = jsonBody<RevokeGrantBody>(event);
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_NOTE_LENGTH) {
    throw new HttpError(400, `note must be <= ${MAX_NOTE_LENGTH} characters`);
  }

  if (grant.status === 'ISSUED') {
    await deleteGrant(rewardId, memberId);
    // No grant to report: it is gone, and saying so is the whole answer.
    return ok({ grant: null, removed: true });
  }

  await setGrantStatus(rewardId, memberId, 'REVOKED');

  return ok({ grant: { ...grant, status: 'REVOKED', ...(note ? { note } : {}) }, removed: false });
}

export const handler = handle(main);
