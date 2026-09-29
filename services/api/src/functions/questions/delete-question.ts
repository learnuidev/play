import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuestionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, noContent, ok, pathParam } from '../../lib/http';
import { addBankQuestionCount } from '../../lib/question-banks';
import { deleteQuestionItem } from '../../lib/questions';
import { deleteLinksForQuestion } from '../../lib/quiz-questions';

/**
 * Deletes a question from its bank.
 *
 * This is also how a *rejected* question goes: a reviewer reads a generated
 * question, sees that it is wrong, and deletes it. There is deliberately no
 * "rejected" status — a question that is not to be asked is not a state to keep
 * it in, and one that was kept would be one somebody has to explain later.
 *
 * Because a question is shared, deleting it takes it out of every quiz that asks
 * it. The links go first and the question last, so a failure part way leaves a
 * question that is still there and can be deleted again rather than a quiz
 * pointing at nothing. The answer says how many quizzes it was asked by, which
 * is what the page shows in its confirmation.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const questionId = pathParam(event, 'questionId');

  const question = await requireQuestionAccess(questionId, userId, 'write');

  const removedFrom = await deleteLinksForQuestion(questionId);
  await deleteQuestionItem(questionId);
  await addBankQuestionCount(question.bankId, -1);

  return ok({ removedFrom });
}

export const handler = handle(main);
