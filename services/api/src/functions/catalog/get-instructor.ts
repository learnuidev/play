import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { toCatalogCourses } from '../../lib/catalog';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { getInstructorWithCourses } from '../../lib/instructors';

/**
 * One instructor's public page: who they are, and what they teach here.
 *
 * Public, like the two catalog routes beside it and for the same reason — this
 * is the page a course page links to, and the people following that link are
 * deciding whether to register, which is not a thing they can be asked to sign
 * in for first.
 *
 * It answers with a 404 when the id teaches nothing listed here and has no
 * profile, which is the catalog's own rule: a page that exists but is empty is a
 * worse answer than one that is not there, and this API does not tell a stranger
 * which ids exist in private.
 *
 * The bio is the person's own words and is rendered by the marketplace as text,
 * never as markup: nothing in this service parses what a profile says.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = pathParam(event, 'userId');

  const result = await getInstructorWithCourses(userId);
  if (!result) throw new HttpError(404, 'Instructor not found');

  return ok({
    instructor: result.instructor,
    courses: await toCatalogCourses(result.spaces),
  });
}

export const handler = handle(main);
