import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCallerContentAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { completionKey, deleteCompletion, getCompletion, putCompletion } from '../../lib/completions';
import { handle, ok, pathParam } from '../../lib/http';
import { requireScope } from '../../lib/oauth-scopes';
import { grantEarnedRewards } from '../../lib/rewards';

/**
 * Marking a lesson done, and taking it back off the list.
 *
 * One resource with two methods, because it is one piece of state: `PUT` says
 * "finished" and `DELETE` says "not finished", and a client toggling a checkbox
 * is doing the same thing either way. Play's own two routes are the same pair
 * under a session.
 *
 * Three things are true of it, and all three are the signed-in behaviour rather
 * than a second set of rules:
 *
 * - **It is the learner's own record.** Reading the lesson is the whole
 *   authorization, because progress is not an editorial act and not an
 *   assessment: it is what somebody has finished, and they may as easily take it
 *   back.
 * - **It is idempotent.** Marking a finished lesson done again is still done, and
 *   the moment it was *first* finished is the one that is kept — so a client that
 *   retries a request it never saw the answer to does not rewrite history.
 * - **It can earn a reward.** Finishing a lesson is the only thing that moves
 *   progress, so it is the only moment a milestone can be crossed, and this
 *   calls the same code the studio's route does. The grants belong to the person
 *   and are read in Play; they are not in this response, because an app that
 *   keeps a progress list has no business enumerating somebody's rewards.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = await requireApiCaller(event);
  requireScope(caller, 'learning:write');

  const contentId = pathParam(event, 'contentId');
  const content = await requireCallerContentAccess(contentId, caller);

  if (event.httpMethod === 'DELETE') {
    // No error when there was nothing to remove: pressing it twice, or on a
    // lesson that was never marked, has asked for the same state either way.
    await deleteCompletion(caller.userId, content.spaceId, contentId);
    return ok({ completed: false });
  }

  const existing = await getCompletion(caller.userId, content.spaceId, contentId);
  if (!existing) {
    await putCompletion({
      userId: caller.userId,
      spaceKey: completionKey(content.spaceId, contentId),
      spaceId: content.spaceId,
      contentId,
      completedAt: Date.now(),
    });
  }

  // Checked even when the completion was already there: a reward added to the
  // course since the lesson was finished is one this learner has already
  // earned, and the next time they touch the lesson is as good a moment as any
  // to say so.
  await grantEarnedRewards({
    spaceId: content.spaceId,
    organizationId: content.organizationId,
    userId: caller.userId,
  });

  return ok({
    completed: true,
    completedAt: existing?.completedAt ?? Date.now(),
  });
}

export const handler = handle(main);
