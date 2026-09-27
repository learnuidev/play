import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCohortAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getCohort, listCohortMemberIds, updateCohort } from '../../lib/cohorts';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseCohortDates, parseCohortDescription, parseCohortName } from '../../lib/cohort-fields';

interface UpdateCohortBody {
  name?: unknown;
  description?: unknown;
  startAt?: unknown;
  endAt?: unknown;
}

/**
 * Edits a cohort: its name, what it says about itself, and when it runs.
 *
 * Who is in it is not here — membership is its own route, because adding a
 * person is an act about that person rather than a rewrite of the group. A date
 * sent as `null` is removed rather than stored, so "this cohort has no end" has
 * one representation.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const cohortId = pathParam(event, 'cohortId');

  const cohort = await requireCohortAccess(cohortId, userId, 'write');
  const body = jsonBody<UpdateCohortBody>(event);

  const patch: Parameters<typeof updateCohort>[1] = {};

  if (body.name !== undefined) patch.name = parseCohortName(body.name);
  if (body.description !== undefined) patch.description = parseCohortDescription(body.description);

  const { startAt, endAt } = parseCohortDates(body.startAt, body.endAt);
  if (body.startAt !== undefined) patch.startAt = startAt ?? null;
  if (body.endAt !== undefined) patch.endAt = endAt ?? null;

  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, 'Nothing to update');
  }

  await updateCohort(cohortId, patch);

  const [updated, memberIds] = await Promise.all([getCohort(cohortId), listCohortMemberIds(cohortId)]);
  return ok({ cohort: { ...(updated ?? cohort), memberIds } });
}

export const handler = handle(main);
