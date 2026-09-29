import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import {
  nextQuestionPosition,
  parseQuestionInput,
  putQuestion,
  toQuestionRow,
  type RawQuestionInput,
} from '../../lib/questions';

/**
 * Adds a question to a quiz by hand.
 *
 * The odd one out among the three ways a question arrives — written, imported
 * and generated — and the one that must work when the other two do not: a
 * teacher fixing a word in a question, or adding the one thing a model keeps
 * missing.
 *
 * It lands at the end of the quiz. Where it goes next is a drag, which is a
 * placement rather than a creation, and asking a dialog to say where in a list
 * of forty a new question belongs is asking it a question the reader cannot
 * answer either.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const quiz = await requireQuizAccess(contentId, userId);
  const body = jsonBody<RawQuestionInput>(event);

  const parsed = parseQuestionInput(body);
  if ('error' in parsed) throw new HttpError(400, parsed.error);

  const now = Date.now();
  const question = toQuestionRow(
    {
      contentId,
      spaceId: quiz.spaceId,
      organizationId: quiz.organizationId,
      parsed: parsed.question,
      source: 'MANUAL',
      position: await nextQuestionPosition(contentId),
      createdBy: userId,
    },
    ulid(),
    now,
  );

  await putQuestion(question);

  return ok({ question }, 201);
}

export const handler = handle(main);
