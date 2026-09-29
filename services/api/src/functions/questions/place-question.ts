import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuestionAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { listAllQuestions, placeQuestion } from '../../lib/questions';

interface PlaceQuestionBody {
  /** Zero-based place in the quiz, counting from the top. */
  index?: unknown;
}

/**
 * Where a question sits in its quiz — the write a drag performs.
 *
 * The place is an index rather than an order, and the resulting order is worked
 * out on the server from what the quiz *currently* holds. A client cannot do
 * that: it drew a list, and between drawing and dropping, a generation may have
 * appended ten questions to the end of it. An index says "third from the top",
 * which is still true after they arrive.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const questionId = pathParam(event, 'questionId');

  const question = await requireQuestionAccess(questionId, userId);
  const body = jsonBody<PlaceQuestionBody>(event);

  if (typeof body.index !== 'number' || !Number.isInteger(body.index) || body.index < 0) {
    throw new HttpError(400, 'index must be a whole number >= 0');
  }

  await placeQuestion(question, body.index);

  return ok({ questions: await listAllQuestions(question.contentId) });
}

export const handler = handle(main);
