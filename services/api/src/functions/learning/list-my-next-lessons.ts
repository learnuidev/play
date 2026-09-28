import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { listCompletionsInSpace } from '../../lib/completions';
import { handle, ok } from '../../lib/http';
import { readSpaceOutline } from '../../lib/outline';
import { listSpaceMembershipsForUser } from '../../lib/space-members';
import type { CourseNextLesson } from '../../types';

/**
 * The lesson each of the caller's courses is up to.
 *
 * "Where am I in this?" is asked by one card per course on the marketplace's own
 * learning page, and answering it course by course would be a request per card —
 * so it is answered here for all of them at once. The courses come from the
 * caller's own memberships, which is the list `GET /me/spaces` returns, and
 * needs no other authorization for the same reason: the query is by their `sub`,
 * so it cannot name a course they are not in.
 *
 * The lesson is the first one in the course's own order the caller has not
 * finished — read from what they marked done rather than inferred from how far
 * they watched, because finishing a lesson is the only thing that moves progress
 * in this product. A learner who jumped to the last lesson and finished it has
 * finished that lesson, not the eleven before it.
 *
 * A course they have finished opens again from the top, and a course with
 * nothing published carries no `contentId` at all: both are honest answers to
 * "what next", and the caller tells them apart by whether the course has lessons,
 * not by this response guessing on its behalf.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const memberships = await listSpaceMembershipsForUser(userId);

  const courses = await Promise.all(
    memberships.map(async (membership): Promise<CourseNextLesson> => {
      const [outline, completions] = await Promise.all([
        readSpaceOutline(membership.spaceId),
        listCompletionsInSpace(userId, membership.spaceId),
      ]);

      const finished = new Set(completions.map((completion) => completion.contentId));
      const lessons = outline.sections.flatMap((section) => section.contents);
      const next = lessons.find((lesson) => !finished.has(lesson.contentId)) ?? lessons[0];

      return { spaceId: membership.spaceId, contentId: next?.contentId };
    }),
  );

  return ok({ courses });
}

export const handler = handle(main);
