import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizReadAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { listQuestionsForQuiz } from '../../lib/quiz-questions';

interface CheckQuizAnswerBody {
  questionId?: unknown;
  optionId?: unknown;
}

/**
 * Whether one answer is right, said now rather than at the end.
 *
 * A learner answers a question and presses *check*: this says whether they were
 * right, what the right option was, and why — which is the moment a quiz teaches
 * anything, and the reason a quiz is sat one question at a time.
 *
 * **It records nothing, and that is the whole of its design.** An attempt is one
 * sitting, written when a sheet is handed in; this is a look at one answer, and a
 * row for every look would turn "how did I do" into a log of keystrokes that
 * nobody reads and nothing can delete. It also means checking is free: a learner
 * can check, be wrong, think, and check the other option without a first wrong
 * answer being kept anywhere.
 *
 * What makes that safe is that this is not a way to *get* the answers cheaply —
 * a learner who checks every question one at a time and then hands in a perfect
 * sheet is doing exactly what the button is for. The alternative considered and
 * rejected was marking on the client: it would mean sending the key to the page,
 * and then there is no quiz, only an honour system.
 *
 * It answers about a question *as it is now*: one that has been unverified since,
 * or removed from the quiz, is not one the learner is being asked, so it is not
 * one this will mark — the same rule the paper follows.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireQuizReadAccess(contentId, userId);
  const body = jsonBody<CheckQuizAnswerBody>(event);

  const questionId = typeof body.questionId === 'string' ? body.questionId.trim() : '';
  if (!questionId) throw new HttpError(400, 'questionId is required');

  const optionId = typeof body.optionId === 'string' ? body.optionId.trim() : '';
  if (!optionId) throw new HttpError(400, 'optionId is required');

  const question = (await listQuestionsForQuiz(contentId)).find(
    (entry) => entry.questionId === questionId && entry.status === 'VERIFIED',
  );
  if (!question) {
    throw new HttpError(404, 'That question is not one this quiz is asking');
  }
  if (!question.options.some((option) => option.id === optionId)) {
    throw new HttpError(400, `"${optionId}" is not one of the options that question offers`);
  }

  return ok({
    questionId: question.questionId,
    optionId,
    correct: question.correctOptionIds.includes(optionId),
    correctOptionIds: question.correctOptionIds,
    ...(question.explanation ? { explanation: question.explanation } : {}),
  });
}

export const handler = handle(main);
