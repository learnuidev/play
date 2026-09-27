import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCohortAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { deleteCohortMember, getCohort, listCohortMemberIds } from '../../lib/cohorts';
import { decodedPathParam, handle, ok, pathParam } from '../../lib/http';

/**
 * Takes somebody out of a cohort, leaving them on the course.
 *
 * A member who is not in the cohort is not an error — the caller asked for them
 * not to be in it and they are not — so this answers with the cohort as it now
 * stands either way.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const cohortId = pathParam(event, 'cohortId');
  const memberId = decodedPathParam(event, 'userId');

  const cohort = await requireCohortAccess(cohortId, userId, 'write');

  const removed = await deleteCohortMember(cohortId, memberId);

  const [updated, memberIds] = await Promise.all([getCohort(cohortId), listCohortMemberIds(cohortId)]);

  return ok({ cohort: { ...(updated ?? cohort), memberIds }, removed });
}

export const handler = handle(main);
