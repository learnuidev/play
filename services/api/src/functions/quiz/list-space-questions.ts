import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getSpace } from '../../lib/spaces';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { countNeedingVerification, listQuestionsBySpace } from '../../lib/questions';

/**
 * Every question about a course's lessons, from every bank.
 *
 * The course page's own read, and the one place a *course* rather than a bank is
 * the way in: an author working through a course wants to know what has been
 * written for the lessons in it, wherever those questions live.
 *
 * Authorized as **organization** membership rather than course membership, and
 * that is the point of the route existing separately from a quiz's: a quiz's
 * questions carry the answer key and ask for a write, while this asks for the
 * organization that owns the course. A learner registered for the course — who
 * may be in no organization at all — is not told what the answers are, and the
 * question of whether they should be is the one a "take a quiz" feature would
 * answer, not this.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await getSpace(spaceId);
  if (!space) throw new HttpError(404, 'Space not found');

  await requireOrganizationAccess(userId, space.organizationId, 'read');

  const questions = await listQuestionsBySpace(spaceId);

  return ok({ questions, needsVerification: countNeedingVerification(questions) });
}

export const handler = handle(main);
