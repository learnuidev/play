import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { listQuestionsForQuiz, placeQuizQuestion } from '../../lib/quiz-questions';

interface PlaceQuestionBody {
  questionId?: unknown;
  /** Zero-based place in the quiz, counting from the top. */
  index?: unknown;
}

/**
 * Where a question sits in the quiz that asks it — the write a drag performs.
 *
 * The place is an index rather than an order, and the resulting order is worked
 * out on the server from what the quiz *currently* asks. A client cannot do
 * that: it drew a list, and between drawing and dropping, somebody else may have
 * added a question to the quiz. An index says "third from the top", which is
 * still true after they do.
 *
 * Note what this does *not* touch: the question's position in its bank. A bank
 * is a library rather than a sequence — the order that matters is the order a
 * learner meets the questions in, and that belongs to the quiz.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireQuizAccess(contentId, userId);
  const body = jsonBody<PlaceQuestionBody>(event);

  if (typeof body.questionId !== 'string' || !body.questionId.trim()) {
    throw new HttpError(400, 'questionId is required');
  }
  if (typeof body.index !== 'number' || !Number.isInteger(body.index) || body.index < 0) {
    throw new HttpError(400, 'index must be a whole number >= 0');
  }

  await placeQuizQuestion(contentId, body.questionId.trim(), body.index);

  return ok({ questions: await listQuestionsForQuiz(contentId) });
}

export const handler = handle(main);
