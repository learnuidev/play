import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { readSpaceProgress } from '../../lib/progress';

/**
 * How far the caller has got in one course.
 *
 * Read by every surface that draws a course's lessons and needs to say which of
 * them somebody has finished: the course page's syllabus, and the classroom's own
 * course tab. Both already read the outline — which is course structure and says
 * nothing about the reader — so the progress beside it is what turns a list of
 * lessons into a record of what is left.
 *
 * Authorized as a read of the course, because that is what it is: anybody who may
 * read a course's outline may read their own progress through it. It is the
 * caller's own progress either way — a member is handed a lesson list, not a
 * class's results.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  await requireSpaceAccess(spaceId, userId, 'read');

  return ok(await readSpaceProgress(userId, spaceId));
}

export const handler = handle(main);
