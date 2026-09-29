import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireBankAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { countNeedingVerification, listQuestionsByBank, updateQuestionStatus } from '../../lib/questions';
import type { QuizQuestion } from '../../types';

interface VerifyQuestionsBody {
  /** The questions to verify. Absent means every one still waiting in the bank. */
  questionIds?: unknown;
}

/**
 * A reviewer accepting a batch of a bank's questions.
 *
 * The one-by-one route is the honest default — a person reads a question and
 * says it is right — and it is not enough on its own, because the questions that
 * arrive in bulk (a generated set, an imported file) are also read in bulk. An
 * author who has to click fifty times for a file they have just been through
 * stops verifying and starts deleting, which is worse for everybody.
 *
 * What it will not do is verify a subset the caller did not name: absent
 * `questionIds` means every question of this bank that is still waiting, and
 * that is stated rather than implied — a route that quietly verified the two
 * questions somebody had already rejected would be a route that undoes work.
 *
 * Verifying here is the same act as verifying from a quiz's page: it is the same
 * question, and the record of who read it is on the question itself.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const bankId = pathParam(event, 'bankId');

  const bank = await requireBankAccess(bankId, userId, 'write');
  const body = jsonBody<VerifyQuestionsBody>(event);

  let ids: string[] | undefined;
  if (body.questionIds !== undefined) {
    if (!Array.isArray(body.questionIds) || body.questionIds.some((id) => typeof id !== 'string')) {
      throw new HttpError(400, 'questionIds must be a list of question ids');
    }
    ids = body.questionIds as string[];
  }

  const questions = await listQuestionsByBank(bank.bankId);

  if (ids !== undefined) {
    const known = new Set(questions.map((question) => question.questionId));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new HttpError(400, `Not a question of this bank: ${unknown.join(', ')}`);
    }
  }

  const targets = questions.filter(
    (question) =>
      question.status === 'NEEDS_VERIFICATION' &&
      (ids === undefined || ids.includes(question.questionId)),
  );

  const now = Date.now();
  const verified: QuizQuestion[] = [];
  for (const question of targets) {
    await updateQuestionStatus(question.questionId, { status: 'VERIFIED', verifiedBy: userId, verifiedAt: now });
    verified.push(question);
  }

  const after = await listQuestionsByBank(bank.bankId);

  return ok({
    verified: verified.length,
    questions: after,
    needsVerification: countNeedingVerification(after),
  });
}

export const handler = handle(main);
