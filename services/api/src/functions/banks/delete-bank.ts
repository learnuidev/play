import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireBankAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { deleteBankItem } from '../../lib/question-banks';
import { deleteQuestionItem, listQuestionsByBank } from '../../lib/questions';
import { deleteLinksForQuestion } from '../../lib/quiz-questions';
import { handle, noContent, pathParam } from '../../lib/http';

/**
 * Deletes a bank, and every question in it.
 *
 * The questions go with it, and that is not a cascade anybody should be
 * surprised by: a bank *is* its questions, and one with no questions in it is a
 * name. What it does mean is that a quiz asking one of them loses it — which is
 * why the questions' links are removed first, and why the page asks twice before
 * calling this.
 *
 * The bank row goes last. If the cascade fails part way, what is left is a bank
 * that still exists with fewer questions in it, and it can be deleted again.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const bankId = pathParam(event, 'bankId');

  await requireBankAccess(bankId, userId, 'write');

  for (const question of await listQuestionsByBank(bankId)) {
    await deleteLinksForQuestion(question.questionId);
    await deleteQuestionItem(question.questionId);
  }

  await deleteBankItem(bankId);

  return noContent();
}

export const handler = handle(main);
