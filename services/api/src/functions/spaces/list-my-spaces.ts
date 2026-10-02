import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { batchGetItems } from '../../lib/dynamodb';
import { handle, ok } from '../../lib/http';
import { batchGetOrganizationsById } from '../../lib/organizations';
import { listPaymentsForUser, paidAtOf } from '../../lib/payments';
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
 *
 * **`purchasedAt` comes from their own payments**, read once for the whole list
 * rather than per course. It is what tells a course page whether this person
 * bought the course or was simply invited into it — the difference between an
 * enrolment they can walk away from and one they cannot — and it is the paid
 * payment's own `paidAt`, so the page, the refund window and the receipt all
 * read the same moment.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const memberships = await listSpaceMembershipsForUser(userId);
  if (memberships.length === 0) return ok({ courses: [] });

  const [spaces, payments] = await Promise.all([
    batchGetItems<Space>(
      SPACES_TABLE,
      memberships.map((membership) => ({ spaceId: membership.spaceId })),
    ),
    listPaymentsForUser(userId),
  ]);
  const byId = new Map(spaces.map((space) => [space.spaceId, space]));

  // One course, one purchase: a course bought twice — which the product allows
  // and does not encourage — reads from the first paid payment on record.
  const purchasedAt = new Map<string, number>();
  for (const payment of payments) {
    if (payment.status !== 'PAID') continue;
    if (!purchasedAt.has(payment.spaceId)) {
      purchasedAt.set(payment.spaceId, paidAtOf(payment));
    }
  }

  const organizations = await batchGetOrganizationsById(
    spaces.map((space) => space.organizationId),
  );

  const courses: MyCourse[] = [];
  for (const membership of memberships) {
    const space = byId.get(membership.spaceId);
    // A membership outliving the course it names is not a course to list.
    if (!space) continue;

    const bought = purchasedAt.get(space.spaceId);
    courses.push({
      space,
      role: membership.role,
      organizationName: organizations.get(space.organizationId)?.name ?? '',
      ...(bought ? { purchasedAt: bought } : {}),
    });
  }

  return ok({ courses });
}

export const handler = handle(main);
