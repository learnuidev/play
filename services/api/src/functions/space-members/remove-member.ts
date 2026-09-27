import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, decodedPathParam, handle, noContent, pathParam } from '../../lib/http';
import { listCohortMembershipsForUser, deleteCohortMember } from '../../lib/cohorts';
import {
  SpaceMemberNotFoundError,
  deleteSpaceMember,
  getSpaceMember,
} from '../../lib/space-members';

/**
 * Takes somebody off a course's roster: an invitation nobody accepted, or a
 * member being removed. Both are the same deletion — the row is the relationship.
 *
 * Their cohort memberships go with them, because a cohort is a grouping *of the
 * course's members* and a cohort holding somebody who is no longer in the course
 * is a list that names a stranger. What does not go is their record of having
 * taken the course: completions and rewards are the learner's, and removing
 * somebody from a roster is not the same act as erasing what they did.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');
  const memberId = decodedPathParam(event, 'userId');

  await requireSpaceAccess(spaceId, userId, 'write');

  const member = await getSpaceMember(spaceId, memberId);
  if (!member) throw new HttpError(404, 'This person is not in this course');

  try {
    await deleteSpaceMember(spaceId, memberId);
  } catch (err) {
    if (err instanceof SpaceMemberNotFoundError) {
      throw new HttpError(404, 'This person is not in this course');
    }
    throw err;
  }

  // Only an accepted member has cohort rows to clean up: an invitation is keyed
  // by an address no cohort ever holds.
  if (member.status === 'ACTIVE') {
    const cohorts = await listCohortMembershipsForUser(memberId);
    for (const cohort of cohorts) {
      if (cohort.spaceId !== spaceId) continue;
      await deleteCohortMember(cohort.cohortId, memberId).catch((err) => {
        console.error('Cohort membership cleanup failed', { spaceId, memberId, err });
      });
    }
  }

  return noContent();
}

export const handler = handle(main);
