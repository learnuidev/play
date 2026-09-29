import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { listAllQuestions, updateQuestionStatus } from '../../lib/questions';
import type { QuizQuestion } from '../../types';

interface VerifyQuestionsBody {
  /** The questions to verify. Absent means every one still waiting. */
  questionIds?: unknown;
}

/**
 * A reviewer accepting a batch of questions.
 *
 * The one-by-one route is the honest default — a person reads a question and
 * says it is right — and it is not enough on its own, because the questions that
 * arrive in bulk (a generated set, an imported file) are also read in bulk. An
 * author who has to click fifty times for a file they have just been through
 * stops verifying and starts deleting, which is worse for everybody.
 *
 * What it will not do is verify a *subset the caller did not name*: absent
 * `questionIds` means every question of this quiz that is still waiting, and
 * that is stated rather than implied — a route that quietly verified the two
 * questions somebody had already rejected would be a route that undoes work.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireQuizAccess(contentId, userId);

  const body = jsonBody<VerifyQuestionsBody>(event);

  let ids: string[] | undefined;
  if (body.questionIds !== undefined) {
    if (!Array.isArray(body.questionIds) || body.questionIds.some((id) => typeof id !== 'string')) {
      throw new HttpError(400, 'questionIds must be a list of question ids');
    }
    ids = body.questionIds as string[];
  }

  const questions = await listAllQuestions(contentId);

  // Only this quiz's own questions, and only the ones that are not already
  // verified: a body naming somebody else's question is a mistake worth
  // refusing rather than a set worth filtering silently.
  const targets = questions.filter((question) => {
    if (question.status === 'VERIFIED') return false;
    return ids === undefined || ids.includes(question.questionId);
  });

  if (ids !== undefined) {
    const known = new Set(questions.map((question) => question.questionId));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new HttpError(400, `Not a question of this quiz: ${unknown.join(', ')}`);
    }
  }

  const now = Date.now();
  const verified: QuizQuestion[] = [];
  for (const question of targets) {
    await updateQuestionStatus(question.questionId, { status: 'VERIFIED', verifiedBy: userId, verifiedAt: now });
    verified.push(question);
  }

  return ok({ verified: verified.length, questions: await listAllQuestions(contentId) });
}

export const handler = handle(main);
