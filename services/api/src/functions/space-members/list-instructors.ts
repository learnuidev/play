import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { handle, ok, pathParam } from '../../lib/http';
import { listSpaceInstructors } from '../../lib/instructors';

/**
 * Who teaches a course.
 *
 * Readable by anybody who can read the course, which is the roster's own rule:
 * knowing who else is in the room is part of being in it, and knowing who is
 * teaching it is the first thing anybody asks about a course. What comes back is
 * the *public* half of each of them — a name, a face, a sentence, their links —
 * because this is the same answer the marketplace gives, and a screen that drew
 * a different one from the same course would be two answers to one question.
 *
 * Separate from the roster rather than a filter over it: the roster is a page of
 * everybody with their roles and addresses, and this is the handful of people a
 * course page credits. A course with three hundred members answers this without
 * reading them.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  await requireSpaceAccess(spaceId, userId, 'read');

  return ok({ instructors: await listSpaceInstructors(spaceId) });
}

export const handler = handle(main);
