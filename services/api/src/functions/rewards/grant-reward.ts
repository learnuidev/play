import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireRewardAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { generateRewardCode, milestoneProgress, putGrant } from '../../lib/rewards';
import { getSpaceMember } from '../../lib/space-members';
import { normalizeEmail } from '../../lib/members';

interface GrantRewardBody {
  /** The member's `sub`. One of this or `email` is required. */
  userId?: unknown;
  email?: unknown;
  /** A code to hand over instead of a generated one. */
  code?: unknown;
  note?: unknown;
}

const MAX_NOTE_LENGTH = 500;

/**
 * Hands a reward to a member by hand.
 *
 * The other way a grant happens is a milestone, which nobody decides. This is for
 * everything a milestone cannot see: the discount an instructor promised, the
 * gift card sent to the person who answered a question well. It records who
 * issued it, because "who gave this out" is the first question asked of a reward
 * somebody says they did not earn.
 *
 * A member may hold one grant per reward, which the table's key enforces: granting
 * again does not issue a second coupon, it returns the one they hold. That is
 * also why this cannot be used to hand out two of the same thing — a limit the
 * milestone route already lives under.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const rewardId = pathParam(event, 'rewardId');

  const reward = await requireRewardAccess(rewardId, userId, 'write');
  const body = jsonBody<GrantRewardBody>(event);

  // Addressed by id when the page has the roster, by address when somebody is
  // typing — the same pair the invitation route accepts, for the same reason.
  let memberId: string | undefined;
  if (typeof body.userId === 'string' && body.userId.trim()) memberId = body.userId.trim();
  else if (typeof body.email === 'string' && body.email.trim()) {
    memberId = normalizeEmail(body.email);
  }
  if (!memberId) throw new HttpError(400, 'userId or email is required');

  const member = await getSpaceMember(reward.spaceId, memberId);
  if (member?.status !== 'ACTIVE') {
    throw new HttpError(404, 'This person is not a member of this course');
  }

  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_NOTE_LENGTH) {
    throw new HttpError(400, `note must be <= ${MAX_NOTE_LENGTH} characters`);
  }

  const code =
    typeof body.code === 'string' && body.code.trim()
      ? body.code.trim().toUpperCase()
      : reward.kind === 'CUSTOM'
        ? undefined
        : generateRewardCode(reward.codePrefix, reward.rewardId);

  const now = Date.now();
  const progress = await milestoneProgress(reward.spaceId, memberId);

  const { grant, created } = await putGrant({
    rewardId,
    userId: memberId,
    spaceId: reward.spaceId,
    organizationId: reward.organizationId,
    ...(code ? { code } : {}),
    status: 'ISSUED',
    grantedBy: userId,
    progress: reward.milestone.type === 'PERCENT_COMPLETE' ? progress.percent : progress.completed,
    ...(note ? { note } : {}),
    grantedAt: now,
    updatedAt: now,
  });

  // 201 for a new grant, 200 for the one they already held: the caller gets the
  // grant either way, and the status says whether this call is what created it.
  return ok({ grant, created }, created ? 201 : 200);
}

export const handler = handle(main);
