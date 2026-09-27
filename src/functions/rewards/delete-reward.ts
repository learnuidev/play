import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireRewardAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, noContent, pathParam } from '../../lib/http';
import { deleteReward } from '../../lib/rewards';

/**
 * Deletes a reward, and the record of who holds it.
 *
 * Deleting is not the way to stop offering something — that is what `active`
 * false is for, and it keeps every grant that was earned while it was on. This
 * is for a reward that should never have existed, which is why the grants go with
 * it: a member holding a reward that no longer exists is a page that renders
 * nothing and a coupon nobody can honour.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const rewardId = pathParam(event, 'rewardId');

  await requireRewardAccess(rewardId, userId, 'write');

  await deleteReward(rewardId);

  return noContent();
}

export const handler = handle(main);
