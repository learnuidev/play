import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import {
  assertRewardShape,
  parseAmountCents,
  parseCodePrefix,
  parseCurrency,
  parseGrantLimit,
  parseInstructions,
  parseMilestone,
  parseRewardDescription,
  parseRewardKind,
  parseRewardName,
} from '../../lib/reward-fields';
import { putReward } from '../../lib/rewards';
import type { SpaceReward } from '../../types';

interface CreateRewardBody {
  name?: unknown;
  description?: unknown;
  kind?: unknown;
  milestone?: unknown;
  amountCents?: unknown;
  currency?: unknown;
  codePrefix?: unknown;
  instructions?: unknown;
  grantLimit?: unknown;
  active?: unknown;
}

/**
 * Adds a reward to a course: what it is, what earns it, and how many there are.
 *
 * The milestone is required, because a reward with no bar to clear is not a
 * milestone reward — it is a gift, and handing those out is what the grant route
 * is for. The kind decides the rest: a code prefix or an amount or an
 * instruction, checked as a set so a gift card without a face value cannot be
 * stored.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await requireSpaceAccess(spaceId, userId, 'write');
  const body = jsonBody<CreateRewardBody>(event);

  const kind = parseRewardKind(body.kind ?? 'COUPON');
  const amountCents = parseAmountCents(body.amountCents);
  const currency = parseCurrency(body.currency);
  const instructions = parseInstructions(body.instructions);
  assertRewardShape({ kind, amountCents, currency, instructions });

  const codePrefix = parseCodePrefix(body.codePrefix);
  const grantLimit = parseGrantLimit(body.grantLimit);

  const now = Date.now();
  const reward: SpaceReward = {
    rewardId: ulid(),
    spaceId,
    organizationId: space.organizationId,
    name: parseRewardName(body.name),
    description: parseRewardDescription(body.description),
    kind,
    milestone: parseMilestone(body.milestone),
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(codePrefix !== undefined ? { codePrefix } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(grantLimit !== undefined ? { grantLimit } : {}),
    // Rewards start switched on: a reward being written is a reward being
    // offered, and pausing it is a deliberate act with its own button.
    active: body.active === undefined ? true : Boolean(body.active),
    grantCount: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await putReward(reward);

  return ok({ reward: { ...reward, grants: [] } }, 201);
}

export const handler = handle(main);
