import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuestionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
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
 * **Both directions answer with the question**, which is the one thing about this
 * route that has been wrong: un-verifying used to end in a `204` with nothing in
 * it, while the client had typed the answer as a question and read `.question`
 * off it — so the call did its work and then threw `Cannot destructure property
 * 'question' of 'param' as it is undefined` at the person who made it. What the
 * body is *for* is the same in both directions: a reviewer working down fifty
 * questions writes each row into the list from this answer rather than watching
 * it blink through a refetch.
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
    return ok({ question: await getQuestion(questionId) });
  }

  await updateQuestionStatus(questionId, {
    status: 'VERIFIED',
    verifiedBy: userId,
    verifiedAt: Date.now(),
  });

  return ok({ question: await getQuestion(questionId) });
}

export const handler = handle(main);
