import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { countNeedingVerification } from '../../lib/questions';
import { listQuestionsForQuiz } from '../../lib/quiz-questions';

/**
 * What a quiz asks, in the order it asks it.
 *
 * The questions come from banks — a quiz owns only the fact that it asks them
 * and in what order — so each one arrives with its bank and the lesson it is
 * about, which is what the page shows beside every row. Two reads: the quiz's
 * own list, then one batch for the questions.
 *
 * Writing, not reading: these carry the answer key. See `requireQuizAccess`.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireQuizAccess(contentId, userId);

  const questions = await listQuestionsForQuiz(contentId);

  return ok({ questions, needsVerification: countNeedingVerification(questions) });
}

export const handler = handle(main);
