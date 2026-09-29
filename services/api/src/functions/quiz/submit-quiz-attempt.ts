import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireQuizReadAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { completionKey, getCompletion, putCompletion } from '../../lib/completions';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { toAttemptAnswer, toQuizAttempt, toWireAttempt, putQuizAttempt } from '../../lib/quiz-attempts';
import { listQuestionsForQuiz } from '../../lib/quiz-questions';
import { grantEarnedRewards } from '../../lib/rewards';
import type { QuizAttemptAnswer, RewardGrant } from '../../types';

interface SubmitQuizAttemptBody {
  /** One entry per question answered. A question left out is one they skipped. */
  answers?: unknown;
  /**
   * The order each question's options were shown in, by question id.
   *
   * The options are dealt afresh on every sitting so the answer is not where the
   * author wrote it, and only the client saw the hand it was dealt. It is
   * recorded rather than re-derived, so the attempt reads in the order it was
   * sat — and it is checked before it is used (`orderedOptions`), because a
   * record of what somebody was shown is worth having exactly when it is what
   * they were shown.
   */
  order?: unknown;
}

/** The submitted order, as a map from question to the option ids in display order. */
function readOrder(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

/**
 * One answer as a learner sent it. Everything is `unknown` until checked.
 *
 * `optionId` is deliberately optional: a learner who skips a question has
 * answered it — with nothing — and that is a different thing from a page that
 * forgot to send the question at all.
 */
interface RawAnswer {
  questionId?: unknown;
  optionId?: unknown;
}

/**
 * Reads the answer sheet, or says why it cannot be read.
 *
 * Two refusals, and both name a client bug rather than a learner's mistake: a
 * question answered twice has no single answer to mark, and an option that is
 * not one of the question's is an id from somewhere else. A question the quiz no
 * longer asks is *not* refused — see the handler — because that is not a bug but
 * an author editing while somebody was sitting the quiz.
 */
function readAnswerSheet(raw: unknown): Map<string, string | undefined> {
  if (!Array.isArray(raw)) {
    throw new HttpError(400, 'answers is required and must be a list of { questionId, optionId }');
  }

  const sheet = new Map<string, string | undefined>();

  for (const entry of raw as RawAnswer[]) {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, 'Each answer must be an object with a questionId');
    }

    const questionId = typeof entry.questionId === 'string' ? entry.questionId.trim() : '';
    if (!questionId) throw new HttpError(400, 'Each answer must name a questionId');

    if (sheet.has(questionId)) {
      throw new HttpError(400, `The same question was answered twice (${questionId})`);
    }

    const rawOption = entry.optionId;
    if (rawOption === undefined || rawOption === null || rawOption === '') {
      sheet.set(questionId, undefined);
      continue;
    }
    if (typeof rawOption !== 'string') {
      throw new HttpError(400, 'An answer’s optionId must be an option id, or absent for a skip');
    }

    sheet.set(questionId, rawOption.trim());
  }

  return sheet;
}

/**
 * Marking a quiz somebody sat.
 *
 * The mark is worked out here and nowhere else, because the answer key is here
 * and nowhere else: a page that marked its own answers would have to be given
 * them, and the whole point of the paper route is that it is not. What comes
 * back is the attempt — the score, and every question with what the learner
 * chose, what answered it, and why.
 *
 * Three things about it are decisions rather than mechanics:
 *
 * - **The questions are the ones asked *now*, and only the verified ones.** The
 *   same rule as the paper: a question nobody has read is not asked, so an
 *   answer to it is not marked. A question an author removed while somebody was
 *   answering is not marked either, and the difference is not hidden — the
 *   attempt comes back with the questions it was marked on, and a page that
 *   submitted twelve and was marked on eleven can say so.
 * - **A skipped question is wrong, not absent.** The score is over the questions
 *   the quiz asks, so leaving one blank is one the learner did not get.
 * - **It finishes the quiz.** Submitting is the learner saying they have had
 *   their go, which is what marking a lesson complete is for a lesson, so the
 *   completion and the course's rewards are written in the same request — a
 *   learner is told what they earned by the call that earned it, and the course
 *   page's progress agrees with the quiz's own page because both read the same
 *   completion. A score is not a threshold: a quiz is not failed here, it is
 *   *taken*, and a learner who scored nothing has still finished it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const quiz = await requireQuizReadAccess(contentId, userId);
  const body = jsonBody<SubmitQuizAttemptBody>(event);
  const sheet = readAnswerSheet(body.answers);
  const order = readOrder(body.order);

  // A sheet of nothing but skips is an empty sheet: the guard is about how many
  // questions were *answered*, not about how many entries were sent, or a
  // learner could finish a quiz by handing in a blank page with the questions
  // named on it.
  if (![...sheet.values()].some((optionId) => optionId !== undefined)) {
    throw new HttpError(400, 'Answer at least one question before submitting');
  }

  const questions = (await listQuestionsForQuiz(contentId)).filter(
    (question) => question.status === 'VERIFIED',
  );
  if (questions.length === 0) {
    throw new HttpError(400, 'This quiz has no verified questions to answer yet');
  }

  const answers: QuizAttemptAnswer[] = [];

  for (const question of questions) {
    const optionId = sheet.get(question.questionId);

    if (optionId !== undefined && !question.options.some((option) => option.id === optionId)) {
      throw new HttpError(
        400,
        `"${optionId}" is not one of the options the question ${question.questionId} offers`,
      );
    }

    answers.push(toAttemptAnswer(question, optionId, order[question.questionId]));
  }

  const submittedAt = Date.now();
  const attempt = toQuizAttempt({
    attemptId: ulid(submittedAt),
    userId,
    quiz,
    answers,
    submittedAt,
  });

  await putQuizAttempt(attempt);

  const existing = await getCompletion(userId, quiz.spaceId, contentId);
  if (!existing) {
    await putCompletion({
      userId,
      spaceKey: completionKey(quiz.spaceId, contentId),
      spaceId: quiz.spaceId,
      contentId,
      completedAt: submittedAt,
    });
  }

  // Checked even when the completion was already there, for the reason
  // `complete-content` gives: a reward added since is one they already earned.
  const earned: RewardGrant[] = await grantEarnedRewards({
    spaceId: quiz.spaceId,
    organizationId: quiz.organizationId,
    userId,
  });

  return ok(
    {
      attempt: toWireAttempt(attempt),
      completed: true,
      completedAt: existing?.completedAt ?? submittedAt,
      earned,
    },
    201,
  );
}

export const handler = handle(main);
