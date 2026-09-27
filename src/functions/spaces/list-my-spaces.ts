import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { batchGetItems } from '../../lib/dynamodb';
import { handle, ok } from '../../lib/http';
import { batchGetOrganizationsById } from '../../lib/organizations';
import { listSpaceMembershipsForUser } from '../../lib/space-members';
import { SPACES_TABLE } from '../../lib/spaces';
import type { MyCourse, Space } from '../../types';

/**
 * The courses the caller is in, across every organization.
 *
 * Scoped to the caller by construction rather than by a check: the query is by
 * their own `sub`, so it cannot name a course they are not in. That is also why
 * it needs no organization to authorize against — a course can be taken by
 * somebody who belongs to no organization at all, and then this is the only list
 * of anything they have.
 *
 * The spaces and organizations are fetched afterwards rather than stored on the
 * membership for the same reason the roster stores ids: a course's title is
 * edited, and a copy of it on every member's row would be a copy to keep true.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const memberships = await listSpaceMembershipsForUser(userId);
  if (memberships.length === 0) return ok({ courses: [] });

  const spaces = await batchGetItems<Space>(
    SPACES_TABLE,
    memberships.map((membership) => ({ spaceId: membership.spaceId })),
  );
  const byId = new Map(spaces.map((space) => [space.spaceId, space]));

  const organizations = await batchGetOrganizationsById(
    spaces.map((space) => space.organizationId),
  );

  const courses: MyCourse[] = [];
  for (const membership of memberships) {
    const space = byId.get(membership.spaceId);
    // A membership outliving the course it names is not a course to list.
    if (!space) continue;

    courses.push({
      space,
      role: membership.role,
      organizationName: organizations.get(space.organizationId)?.name ?? '',
    });
  }

  return ok({ courses });
}

export const handler = handle(main);
