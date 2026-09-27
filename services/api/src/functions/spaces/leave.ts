import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';
import { deleteSpaceMember, getSpaceMember } from '../../lib/space-members';

/**
 * Drops the caller out of a course.
 *
 * The mirror of registering, and the reason a learner can undo a decision made
 * on a front page. What it removes is the membership — the row *is* the
 * relationship — and what it leaves behind is the course: the organization that
 * wrote it still owns it, and the progress the caller made stays with their
 * account, so registering again resumes rather than restarts.
 *
 * Nothing is checked but that they are in it: an instructor may leave a course
 * they no longer run, and somebody who was never in it gets a 404 rather than a
 * silent success, because "you are not in this course" is worth saying.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const spaceId = pathParam(event, 'spaceId');

  const member = await getSpaceMember(spaceId, user.userId);
  if (!member || member.status !== 'ACTIVE') {
    throw new HttpError(404, 'You are not in this course');
  }

  await deleteSpaceMember(spaceId, user.userId);
  return noContent();
}

export const handler = handle(main);
