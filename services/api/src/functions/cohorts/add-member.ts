import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCohortAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addCohortMember, getCohort, listCohortMemberIds } from '../../lib/cohorts';
import { HttpError, decodedPathParam, handle, ok, pathParam } from '../../lib/http';
import { getSpaceMember } from '../../lib/space-members';

/**
 * Puts a course member into a cohort.
 *
 * Only somebody who is actually in the course: a cohort is a grouping *of the
 * course's members*, and a group holding a person who is not on the roster is a
 * list that names a stranger. An outstanding invitation is not membership, so it
 * cannot be grouped either — the invitation is claimed first, and then the person
 * is added.
 *
 * Both requirements are enforced here rather than by a condition on the write,
 * because the membership and the cohort are in two different tables: the check is
 * a read, and the write is idempotent, so a repeated tap is the state the caller
 * asked for rather than an error.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const cohortId = pathParam(event, 'cohortId');
  const memberId = decodedPathParam(event, 'userId');

  const cohort = await requireCohortAccess(cohortId, userId, 'write');

  const member = await getSpaceMember(cohort.spaceId, memberId);
  if (member?.status !== 'ACTIVE') {
    throw new HttpError(404, 'This person is not a member of this course');
  }

  const added = await addCohortMember({
    cohortId,
    userId: memberId,
    spaceId: cohort.spaceId,
    addedBy: userId,
  });

  const [updated, memberIds] = await Promise.all([getCohort(cohortId), listCohortMemberIds(cohortId)]);

  // `added` says whether this call is what changed it, which the page uses to
  // decide between "added" and "they were already in it" — the counter only
  // moves once either way.
  return ok({ cohort: { ...(updated ?? cohort), memberIds }, added });
}

export const handler = handle(main);
