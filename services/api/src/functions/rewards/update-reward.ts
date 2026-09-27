import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireRewardAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import {
  assertRewardShape,
  parseAmountCents,
  parseCodePrefix,
  parseCurrency,
  parseGrantLimit,
  parseInstructions,
  parseMilestone,
  parseRewardDescription,
  parseRewardName,
} from '../../lib/reward-fields';
import { getReward, listGrantsForReward, updateReward } from '../../lib/rewards';

interface UpdateRewardBody {
  name?: unknown;
  description?: unknown;
  milestone?: unknown;
  amountCents?: unknown;
  currency?: unknown;
  codePrefix?: unknown;
  instructions?: unknown;
  grantLimit?: unknown;
  active?: unknown;
}

/**
 * Edits a reward's definition.
 *
 * The kind is deliberately not editable: moving a coupon to a gift card changes
 * what has already been handed out — a code generated as a coupon is not a
 * balance anyone funded — so it is a new reward rather than an edit to this one.
 * Everything else is editable, including the milestone, which changes what the
 * next person has to do and never what somebody already holds.
 *
 * A grant limit below the number already granted is refused rather than clamped:
 * the limit is a promise about how many exist, and quietly ignoring it would make
 * the number on the card a lie.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const rewardId = pathParam(event, 'rewardId');

  const reward = await requireRewardAccess(rewardId, userId, 'write');
  const body = jsonBody<UpdateRewardBody>(event);

  const patch: Parameters<typeof updateReward>[1] = {};

  if (body.name !== undefined) patch.name = parseRewardName(body.name);
  if (body.description !== undefined) patch.description = parseRewardDescription(body.description);
  if (body.milestone !== undefined) patch.milestone = parseMilestone(body.milestone);
  if (body.active !== undefined) patch.active = Boolean(body.active);

  // `null` clears a field; `undefined` leaves it alone. The shape is checked
  // against what the reward *would* be, so clearing a gift card's amount while it
  // is still a gift card is refused.
  const amountCents = body.amountCents === null ? null : parseAmountCents(body.amountCents);
  const currency = body.currency === null ? null : parseCurrency(body.currency);
  const codePrefix = body.codePrefix === null ? null : parseCodePrefix(body.codePrefix);
  const instructions = body.instructions === null ? null : parseInstructions(body.instructions);
  const grantLimit = body.grantLimit === null ? null : parseGrantLimit(body.grantLimit);

  if (body.amountCents !== undefined) patch.amountCents = amountCents;
  if (body.currency !== undefined) patch.currency = currency;
  if (body.codePrefix !== undefined) patch.codePrefix = codePrefix;
  if (body.instructions !== undefined) patch.instructions = instructions;

  if (grantLimit !== undefined && grantLimit !== null) {
    if (grantLimit < reward.grantCount) {
      throw new HttpError(
        400,
        `grantLimit cannot be below the ${reward.grantCount} already granted`,
      );
    }
    patch.grantLimit = grantLimit;
  } else if (body.grantLimit === null) {
    patch.grantLimit = null;
  }

  assertRewardShape({
    kind: reward.kind,
    amountCents: amountCents === null ? undefined : (amountCents ?? reward.amountCents),
    currency: currency === null ? undefined : (currency ?? reward.currency),
    instructions: instructions === null ? undefined : (instructions ?? reward.instructions),
  });

  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to update');

  await updateReward(rewardId, patch);

  const [updated, grants] = await Promise.all([getReward(rewardId), listGrantsForReward(rewardId)]);
  return ok({ reward: { ...(updated ?? reward), grants } });
}

export const handler = handle(main);
