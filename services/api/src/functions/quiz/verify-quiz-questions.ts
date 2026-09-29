import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { countNeedingVerification, updateQuestionStatus } from '../../lib/questions';
import { listQuestionsForQuiz } from '../../lib/quiz-questions';

interface VerifyQuizQuestionsBody {
  /** The questions to verify. Absent means every one of this quiz still waiting. */
  questionIds?: unknown;
}

/**
 * A reviewer accepting the questions of one quiz in a batch.
 *
 * The same act as the bank's own batch route — it is the same question, and the
 * record of who read it goes on the question — reached from the page the author
 * is actually working on. A quiz asks a selection of a bank, and making somebody
 * leave to verify what is in front of them is how a verification stops happening.
 *
 * Without `questionIds` it verifies every question *of this quiz* that is still
 * waiting, which is narrower than the bank's version of the same route and
 * deliberately so: somebody looking at a quiz means the questions in it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireQuizAccess(contentId, userId);
  const body = jsonBody<VerifyQuizQuestionsBody>(event);

  let ids: string[] | undefined;
  if (body.questionIds !== undefined) {
    if (!Array.isArray(body.questionIds) || body.questionIds.some((id) => typeof id !== 'string')) {
      throw new HttpError(400, 'questionIds must be a list of question ids');
    }
    ids = body.questionIds as string[];
  }

  const questions = await listQuestionsForQuiz(contentId);

  if (ids !== undefined) {
    const known = new Set(questions.map((question) => question.questionId));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new HttpError(400, `Not a question of this quiz: ${unknown.join(', ')}`);
    }
  }

  const targets = questions.filter(
    (question) =>
      question.status === 'NEEDS_VERIFICATION' &&
      (ids === undefined || ids.includes(question.questionId)),
  );

  const now = Date.now();
  for (const question of targets) {
    await updateQuestionStatus(question.questionId, { status: 'VERIFIED', verifiedBy: userId, verifiedAt: now });
  }

  const after = await listQuestionsForQuiz(contentId);

  return ok({
    verified: targets.length,
    questions: after,
    needsVerification: countNeedingVerification(after),
  });
}

export const handler = handle(main);
