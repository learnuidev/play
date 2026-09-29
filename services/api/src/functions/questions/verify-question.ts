import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuestionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, noContent, ok, pathParam } from '../../lib/http';
import { getQuestion, updateQuestionStatus } from '../../lib/questions';

/**
 * A person saying a question is right — or taking that back.
 *
 * The whole point of the status a generated question arrives with is that this
 * is a *person*: the answer is recorded against the caller's own `sub`, so a
 * question that marked a learner wrong can be traced to whoever read it and
 * agreed.
 *
 * One function serves both directions because they are one decision with two
 * positions, and the route says which: `PUT` verifies, `DELETE` un-verifies.
 * Un-verifying *removes* the record rather than blanking it — "nobody has
 * checked this" is the absence of the fact, and a row carrying an empty name is
 * a row somebody has to read carefully to understand.
 *
 * Verifying here and verifying from a quiz's page are the same act on the same
 * question: it is shared, so it is verified once.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const questionId = pathParam(event, 'questionId');

  await requireQuestionAccess(questionId, userId, 'write');

  if (event.httpMethod === 'DELETE') {
    await updateQuestionStatus(questionId, { status: 'NEEDS_VERIFICATION' });
    return noContent();
  }

  await updateQuestionStatus(questionId, {
    status: 'VERIFIED',
    verifiedBy: userId,
    verifiedAt: Date.now(),
  });

  return ok({ question: await getQuestion(questionId) });
}

export const handler = handle(main);
