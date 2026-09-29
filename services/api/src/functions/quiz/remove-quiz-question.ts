import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, noContent, pathParam } from '../../lib/http';
import { removeQuestionFromQuiz } from '../../lib/quiz-questions';

/**
 * Takes a question out of a quiz.
 *
 * The question itself is untouched. It lives in a bank, another quiz may be
 * asking it, and a quiz changing its mind is not an author deleting work — which
 * is why this is a route of its own rather than a `?delete=true` on the one
 * beside it. Deleting the question from its bank is
 * `DELETE /questions/{questionId}`, and the page offers both.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireQuizAccess(contentId, userId);
  await removeQuestionFromQuiz(contentId, pathParam(event, 'questionId'));

  return noContent();
}

export const handler = handle(main);
