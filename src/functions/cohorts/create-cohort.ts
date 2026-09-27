import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { putCohort } from '../../lib/cohorts';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseCohortDates, parseCohortDescription, parseCohortName } from '../../lib/cohort-fields';
import type { Cohort } from '../../types';

interface CreateCohortBody {
  name?: unknown;
  description?: unknown;
  startAt?: unknown;
  endAt?: unknown;
}

/**
 * Creates a cohort: a named group of a course's members.
 *
 * Empty when it is made, because a group is defined by who is in it and that is
 * decided from the roster rather than typed in at creation. Starting empty also
 * means a half-made cohort is visible and correct rather than half-filled.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  const space = await requireSpaceAccess(spaceId, userId, 'write');
  const body = jsonBody<CreateCohortBody>(event);

  const now = Date.now();
  // A date sent as `null` means "clear it", which is an edit; a cohort being
  // created either has a run or does not, so `null` and absence are the same
  // thing here.
  const { startAt, endAt } = parseCohortDates(body.startAt, body.endAt);

  const cohort: Cohort = {
    cohortId: ulid(),
    spaceId,
    organizationId: space.organizationId,
    name: parseCohortName(body.name),
    description: parseCohortDescription(body.description),
    ...(typeof startAt === 'number' ? { startAt } : {}),
    ...(typeof endAt === 'number' ? { endAt } : {}),
    memberCount: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await putCohort(cohort);

  return ok({ cohort: { ...cohort, memberIds: [] } }, 201);
}

export const handler = handle(main);
