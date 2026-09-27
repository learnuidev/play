import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { toCatalogCourses } from '../../lib/catalog';
import { encodeNextToken, handle, ok, parsePaging } from '../../lib/http';
import { listListedSpaces } from '../../lib/spaces';

/**
 * The marketplace's front page: courses their authors have listed.
 *
 * Deliberately unauthenticated. A catalog that required an account to read
 * would be a catalog nobody reads — deciding whether to register for a course
 * is what happens *before* you have one — and nothing here is anybody's: it is
 * what each course says about itself in public.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { spaces, lastEvaluatedKey } = await listListedSpaces(parsePaging(event));
  const courses = await toCatalogCourses(spaces);

  return ok({ courses, nextToken: encodeNextToken(lastEvaluatedKey) });
}

export const handler = handle(main);
