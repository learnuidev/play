import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getContent, updateContent } from '../../lib/contents';
import { HttpError, handle, jsonBody, noContent, ok, pathParam } from '../../lib/http';
import {
  isGenerationActive,
  publishGeneration,
  resolveQuestionCount,
  resolveQuestionTypes,
  type GenerationJobDetail,
} from '../../lib/quiz-generation';
import type { QuizGeneration } from '../../types';

interface GenerateQuestionsBody {
  /** The lesson to write questions from. */
  sourceContentId?: unknown;
  count?: unknown;
  types?: unknown;
}

/**
 * Asks for questions to be written from a lesson — or forgets the last answer.
 *
 * The request *starts* the work and answers with the quiz, which now carries a
 * queued run — it does not wait for the questions, because it cannot: a model
 * reading a transcript and writing ten questions takes longer than API Gateway
 * will hold a REST request open, and a route that tried would fail on exactly
 * the lessons worth generating from.
 *
 * `DELETE` on the same route is the other half: it clears the record. A run that
 * failed leaves its reason on the quiz, which is the right place for it until
 * the author has read it — and this is how they say they have. It is the same
 * decision in two directions, which is why it is one function.
 *
 * The three refusals worth naming:
 *
 * - **a lesson of another course** — questions are written from something in the
 *   course they will be asked in, and a source id from elsewhere is either a
 *   mistake or an attempt to read a lesson the caller cannot read;
 * - **a quiz as the source** — a model asked to write questions about a set of
 *   questions writes questions about the wording of the questions;
 * - **a run already going** — two runs writing into one quiz at once is two
 *   lists interleaved, and the second author's questions arriving in the middle
 *   of the first author's. A run that died is not "already going": see
 *   `isGenerationActive`, which is what makes a stuck run recoverable.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const quiz = await requireQuizAccess(contentId, userId);

  if (event.httpMethod === 'DELETE') {
    await updateContent(contentId, { generation: null });
    return noContent();
  }

  const body = jsonBody<GenerateQuestionsBody>(event);

  if (typeof body.sourceContentId !== 'string' || !body.sourceContentId.trim()) {
    throw new HttpError(400, 'sourceContentId is required');
  }

  const source = await getContent(body.sourceContentId.trim());
  if (!source || source.spaceId !== quiz.spaceId) {
    throw new HttpError(400, 'Questions are written from a lesson of this course');
  }
  if (source.type === 'QUIZ') {
    throw new HttpError(400, 'Questions are written from a lesson, not from another quiz');
  }

  // A cheap check that saves a whole round trip through the queue: a lesson with
  // no video and no notes has nothing for a model to read, and the run would
  // only be able to fail. The video's subtitles are checked by the worker, which
  // is the first thing that can know whether they are ready.
  if (!source.videoId && !source.notes) {
    throw new HttpError(400, 'That lesson has no video and no notes to write questions from');
  }

  if (isGenerationActive(quiz.generation)) {
    throw new HttpError(409, 'Questions are already being written for this quiz');
  }

  const count = resolveQuestionCount(body.count);
  const types = resolveQuestionTypes(body.types);
  const requestedAt = Date.now();

  const detail: GenerationJobDetail = {
    contentId,
    sourceContentId: source.contentId,
    count,
    types,
    requestedBy: userId,
    requestedAt,
  };

  const generation: QuizGeneration = {
    status: 'QUEUED',
    sourceContentId: source.contentId,
    count,
    types,
    requestedBy: userId,
    requestedAt,
  };

  // The record is written before the event is published, so the page that polls
  // this quiz cannot see a run it does not know about — the other order leaves a
  // window in which the worker has already started and the quiz still says
  // nothing is happening.
  await updateContent(contentId, { generation });

  try {
    await publishGeneration(detail);
  } catch (err) {
    // A run that was never handed over is not a run: the record goes back to
    // failed rather than leaving the page polling something that will never
    // finish.
    await updateContent(contentId, {
      generation: {
        ...generation,
        status: 'FAILED',
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : 'Could not queue the generation',
      },
    });
    throw new HttpError(500, 'Could not queue the generation — try again');
  }

  return ok({ content: await getContent(contentId) }, 202);
}

export const handler = handle(main);
