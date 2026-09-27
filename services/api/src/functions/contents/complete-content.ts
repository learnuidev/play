import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { completionKey, getCompletion, putCompletion } from '../../lib/completions';
import { handle, ok, pathParam } from '../../lib/http';
import { grantEarnedRewards } from '../../lib/rewards';
import type { RewardGrant } from '../../types';

/**
 * Marks a lesson done.
 *
 * Reading the lesson is all this needs: progress is the learner's own record of
 * what they have finished, not an editorial act and not an assessment — so any
 * member may keep it, and may as easily take it back.
 *
 * It is idempotent: marking something done twice is still done, and the moment
 * it was first finished is the one that is kept.
 *
 * This is also where a course's rewards are earned. Finishing a lesson is the
 * only thing that moves progress, so it is the only moment a milestone can be
 * crossed — and checking here means a learner is told what they earned by the
 * same request that earned it. The check never fails the request (see
 * `grantEarnedRewards`): a reward that could not be issued must not turn into a
 * lesson that could not be completed.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const content = await requireContentAccess(contentId, userId, 'read');

  const existing = await getCompletion(userId, content.spaceId, contentId);
  if (!existing) {
    await putCompletion({
      userId,
      spaceKey: completionKey(content.spaceId, contentId),
      spaceId: content.spaceId,
      contentId,
      completedAt: Date.now(),
    });
  }

  // Checked even when the completion was already there: a reward added to the
  // course since the lesson was finished is one this learner has already earned,
  // and the next time they touch the lesson is as good a moment as any to say so.
  const earned: RewardGrant[] = await grantEarnedRewards({
    spaceId: content.spaceId,
    organizationId: content.organizationId,
    userId,
  });

  return ok({
    completed: true,
    completedAt: existing?.completedAt ?? Date.now(),
    // Handed back so the page can say what was won without a second request.
    earned,
  });
}

export const handler = handle(main);
