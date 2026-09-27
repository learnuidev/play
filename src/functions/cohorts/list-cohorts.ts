import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { listCohortsWithMembers } from '../../lib/cohorts';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * A course's cohorts, each with the members in it.
 *
 * Read whole rather than paged: a course has a handful of cohorts, and the page
 * draws every one of them with its people under it. The member *ids* are what
 * comes back — the roster is the space's own read, and a cohort is a grouping of
 * it rather than a second copy of it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  await requireSpaceAccess(spaceId, userId, 'read');

  const cohorts = await listCohortsWithMembers(spaceId);

  return ok({ cohorts });
}

export const handler = handle(main);
