import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { batchGetItems } from '../../lib/dynamodb';
import { handle, ok } from '../../lib/http';
import { listGrantsForUser, SPACE_REWARDS_TABLE } from '../../lib/rewards';
import { SPACES_TABLE } from '../../lib/spaces';
import type { MyReward, Space, SpaceReward } from '../../types';

/**
 * What the caller has earned, across every course.
 *
 * Scoped to the caller by construction rather than by a check: the query is by
 * their own `sub`, so it cannot return somebody else's reward. The reward's own
 * definition and the course are fetched afterwards, because a code with no
 * context — which reward, from which course, for doing what — is a string nobody
 * can act on.
 *
 * A revoked grant is left out: what was taken back is not something to show
 * somebody as theirs. A grant whose reward has been deleted goes with it, for the
 * same reason.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const all = await listGrantsForUser(userId);
  const grants = all.filter((grant) => grant.status !== 'REVOKED');
  if (grants.length === 0) return ok({ rewards: [] });

  const [rewards, spaces] = await Promise.all([
    batchGetItems<SpaceReward>(
      SPACE_REWARDS_TABLE,
      grants.map((grant) => ({ rewardId: grant.rewardId })),
    ),
    batchGetItems<Space>(
      SPACES_TABLE,
      grants.map((grant) => ({ spaceId: grant.spaceId })),
    ),
  ]);

  const rewardsById = new Map(rewards.map((reward) => [reward.rewardId, reward]));
  const spacesById = new Map(spaces.map((space) => [space.spaceId, space]));

  const mine: MyReward[] = [];
  for (const grant of grants) {
    const reward = rewardsById.get(grant.rewardId);
    if (!reward) continue;
    const space = spacesById.get(grant.spaceId);

    mine.push({
      ...grant,
      reward,
      spaceTitle: space?.title ?? '',
      orgId: space?.organizationId ?? grant.organizationId,
    });
  }

  return ok({ rewards: mine });
}

export const handler = handle(main);
