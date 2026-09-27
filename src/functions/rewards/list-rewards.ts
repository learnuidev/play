import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { listGrantsForReward, listRewardsBySpace } from '../../lib/rewards';
import type { RewardGrant, SpaceReward } from '../../types';

/**
 * A course's rewards, each with the grants made under it.
 *
 * Read together rather than one reward at a time, because a reward list is only
 * useful with its numbers: "how many have we given out, and to whom" is the
 * question the page exists to answer. A course has a handful of rewards, so the
 * grants are fetched per reward — bounded by the list rather than by the roster.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  await requireSpaceAccess(spaceId, userId, 'read');

  const rewards = await listRewardsBySpace(spaceId);

  const withGrants: (SpaceReward & { grants: RewardGrant[] })[] = [];
  for (const reward of rewards) {
    withGrants.push({ ...reward, grants: await listGrantsForReward(reward.rewardId) });
  }

  return ok({ rewards: withGrants });
}

export const handler = handle(main);
