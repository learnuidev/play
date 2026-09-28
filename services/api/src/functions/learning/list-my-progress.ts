import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { handle, ok } from '../../lib/http';
import { readSpaceProgress } from '../../lib/progress';
import { listSpaceMembershipsForUser } from '../../lib/space-members';
import type { CourseProgress } from '../../types';

/**
 * How far the caller has got in each of their courses.
 *
 * "Where am I in this?" is asked by one card per course on the marketplace's own
 * learning page — the percentage on the card, and the lesson it offers to carry
 * on with — and answering it course by course would be a request per card. So it
 * is answered here for all of them at once.
 *
 * The courses come from the caller's own memberships, which is the list
 * `GET /me/spaces` returns, and needs no other authorization for the same
 * reason: the query is by their `sub`, so it cannot name a course they are not
 * in.
 *
 * The finished lessons are not listed here — see `get-space-progress`, which is
 * the read that draws ticks. A card wants the numbers, and this is one response
 * for a whole page of cards.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const memberships = await listSpaceMembershipsForUser(userId);

  const courses = await Promise.all(
    memberships.map(async (membership): Promise<CourseProgress> => {
      const { spaceId, lessonCount, completedCount, nextContentId } = await readSpaceProgress(
        userId,
        membership.spaceId,
      );

      return { spaceId, lessonCount, completedCount, nextContentId };
    }),
  );

  return ok({ courses });
}

export const handler = handle(main);
