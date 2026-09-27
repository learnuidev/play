import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCohortAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { deleteCohort } from '../../lib/cohorts';
import { handle, noContent, pathParam } from '../../lib/http';

/**
 * Deletes a cohort and the memberships that say who was in it.
 *
 * The members themselves are untouched: a cohort is a way of looking at a
 * course's roster, not a container people live in. Deleting the group does not
 * take anybody off the course.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const cohortId = pathParam(event, 'cohortId');

  await requireCohortAccess(cohortId, userId, 'write');

  await deleteCohort(cohortId);

  return noContent();
}

export const handler = handle(main);
