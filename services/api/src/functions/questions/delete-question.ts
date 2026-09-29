import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuestionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, noContent, pathParam } from '../../lib/http';
import { renumberQuestions, deleteQuestionItem, listAllQuestions } from '../../lib/questions';

/**
 * Removes a question from a quiz.
 *
 * This is also how a *rejected* question goes: a reviewer reads a generated
 * question, sees that it is wrong, and deletes it. There is deliberately no
 * "rejected" status — a question that is not to be asked is not a state to keep
 * it in, and one that was kept would be one somebody has to explain later.
 *
 * The gap it leaves is closed, so a quiz does not accumulate holes in its
 * ordering as its author works through what a model wrote.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const questionId = pathParam(event, 'questionId');

  const question = await requireQuestionAccess(questionId, userId);

  await deleteQuestionItem(questionId);
  await renumberQuestions(
    (await listAllQuestions(question.contentId)).filter((entry) => entry.questionId !== questionId),
  );

  return noContent();
}

export const handler = handle(main);
