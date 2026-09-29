import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { listAllContentsBySpace } from '../../lib/contents';
import { handle, ok, pathParam } from '../../lib/http';
import { listAllSectionsBySpace } from '../../lib/sections';
import { countSpaceStudents } from '../../lib/space-members';

/**
 * What a course adds up to: the numbers an overview puts on cards.
 *
 * Read as counts rather than lists, and on their own route rather than bolted
 * onto the space, so opening a course does not wait on counting its students —
 * the course itself is what the page needs to render, and these four numbers are
 * what the overview adds to it.
 *
 * Quizzes are counted off the content read the lessons are counted off, rather
 * than by asking a table of their own: a quiz *is* content, so it is already in
 * the page this endpoint fetches, and the questions table could not answer the
 * question anyway — it is keyed by quiz, not by course.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = pathParam(event, 'spaceId');

  await requireSpaceAccess(spaceId, userId, 'read');

  const [students, sectionPage, contentPage] = await Promise.all([
    countSpaceStudents(spaceId),
    listAllSectionsBySpace(spaceId),
    listAllContentsBySpace(spaceId),
  ]);

  return ok({
    stats: {
      students,
      sections: sectionPage.sections.length,
      contents: contentPage.contents.length,
      quizzes: contentPage.contents.filter((content) => content.type === 'QUIZ').length,
    },
    // The reads behind these counts carry their own ceilings; past them the
    // numbers are what was read rather than what is there, and saying so beats
    // a total nobody can tell is short.
    truncated: sectionPage.truncated || contentPage.truncated,
  });
}

export const handler = handle(main);
