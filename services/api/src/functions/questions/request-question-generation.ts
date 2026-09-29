import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireBankAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getContent } from '../../lib/contents';
import { HttpError, handle, jsonBody, noContent, ok, pathParam } from '../../lib/http';
import { getBank, updateBank } from '../../lib/question-banks';
import { assertLesson } from '../../lib/questions';
import {
  isGenerationActive,
  publishGeneration,
  resolveQuestionCount,
  resolveQuestionTypes,
  type GenerationJobDetail,
} from '../../lib/quiz-generation';
import type { QuizGeneration } from '../../types';

interface GenerateQuestionsBody {
  /** The lesson to write questions from — which is also what they are about. */
  lessonContentId?: unknown;
  count?: unknown;
  types?: unknown;
  /** A quiz to add them to once they are written. */
  addToContentId?: unknown;
}

/**
 * Asks for questions to be written from a lesson — or forgets the last answer.
 *
 * The request *starts* the work and answers with the bank, which now carries a
 * queued run — it does not wait for the questions, because it cannot: a model
 * reading a transcript and writing ten questions takes longer than API Gateway
 * will hold a REST request open, and a route that tried would fail on exactly
 * the lessons worth generating from.
 *
 * `DELETE` on the same route is the other half: it clears the record. A run that
 * failed leaves its reason on the bank, which is the right place for it until
 * the author has read it — and this is how they say they have. It is the same
 * decision in two directions, which is why it is one function.
 *
 * Three refusals worth naming:
 *
 * - **a lesson of another organization** — the lesson must be one this bank's
 *   organization owns, which is what stops a stray id from writing questions
 *   about a course the caller cannot read;
 * - **a quiz in another course** — questions are written for one lesson, so a
 *   quiz they can be added to is a quiz in *that* lesson's course, or none;
 * - **a run already going** — two runs writing into one bank at once is two
 *   lists interleaved. A run that died is not "already going": see
 *   `isGenerationActive`, which is what makes a stuck run recoverable.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const bankId = pathParam(event, 'bankId');

  const bank = await requireBankAccess(bankId, userId, 'write');

  if (event.httpMethod === 'DELETE') {
    await updateBank(bank.bankId, { generation: null });
    return noContent();
  }

  const body = jsonBody<GenerateQuestionsBody>(event);

  if (typeof body.lessonContentId !== 'string' || !body.lessonContentId.trim()) {
    throw new HttpError(400, 'lessonContentId is required — questions are written about a lesson');
  }

  const lesson = await getContent(body.lessonContentId.trim());
  assertLesson(lesson, bank.organizationId);

  // A cheap check that saves a whole round trip through the queue: a lesson with
  // no video and no notes has nothing for a model to read, and the run would
  // only be able to fail. Whether the video has *subtitles* is checked by the
  // worker, which is the first thing that can know.
  if (!lesson.videoId && !lesson.notes) {
    throw new HttpError(400, 'That lesson has no video and no notes to write questions from');
  }

  if (typeof body.addToContentId === 'string' && body.addToContentId.trim()) {
    const quiz = await getContent(body.addToContentId.trim());
    if (!quiz || quiz.type !== 'QUIZ') {
      throw new HttpError(400, 'addToContentId must be a quiz');
    }
    // The lesson's own course, so the questions written about it are questions
    // that quiz's learners can actually be asked.
    if (quiz.spaceId !== lesson.spaceId) {
      throw new HttpError(400, 'A quiz can only be given questions about its own course’s lessons');
    }
  }

  const fresh = await getBank(bank.bankId);
  if (isGenerationActive(fresh?.generation)) {
    throw new HttpError(409, 'Questions are already being written for this bank');
  }

  const count = resolveQuestionCount(body.count);
  const types = resolveQuestionTypes(body.types);
  const requestedAt = Date.now();

  const addToContentId =
    typeof body.addToContentId === 'string' && body.addToContentId.trim()
      ? body.addToContentId.trim()
      : undefined;

  const detail: GenerationJobDetail = {
    bankId: bank.bankId,
    lessonContentId: lesson.contentId,
    count,
    types,
    ...(addToContentId ? { addToContentId } : {}),
    requestedBy: userId,
    requestedAt,
  };

  const generation: QuizGeneration = {
    status: 'QUEUED',
    bankId: bank.bankId,
    lessonContentId: lesson.contentId,
    count,
    types,
    ...(addToContentId ? { addToContentId } : {}),
    requestedBy: userId,
    requestedAt,
  };

  // The record is written before the event is published, so the page that polls
  // this bank cannot see a run it does not know about — the other order leaves a
  // window in which the worker has already started and the bank still says
  // nothing is happening.
  await updateBank(bank.bankId, { generation });

  try {
    await publishGeneration(detail);
  } catch (err) {
    // A run that was never handed over is not a run: the record goes back to
    // failed rather than leaving the page polling something that will never
    // finish.
    await updateBank(bank.bankId, {
      generation: {
        ...generation,
        status: 'FAILED',
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : 'Could not queue the generation',
      },
    });
    throw new HttpError(500, 'Could not queue the generation — try again');
  }

  return ok({ bank: await getBank(bank.bankId) }, 202);
}

export const handler = handle(main);
