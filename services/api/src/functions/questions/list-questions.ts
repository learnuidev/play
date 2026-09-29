import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireQuizAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { countNeedingVerification, listAllQuestions } from '../../lib/questions';

/**
 * A quiz's questions, in the order it asks them.
 *
 * Read whole rather than paged, and with the count of what still needs reading:
 * the author's page draws a review state ("seven of ten verified") above a list
 * they work down, and both come from the one read rather than the list being
 * counted by the client.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  // Writing, not reading: these questions carry the answer key. See
  // `requireQuizAccess`.
  await requireQuizAccess(contentId, userId);

  const questions = await listAllQuestions(contentId);

  return ok({ questions, needsVerification: countNeedingVerification(questions) });
}

export const handler = handle(main);
