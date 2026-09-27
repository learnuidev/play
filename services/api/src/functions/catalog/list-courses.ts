import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { searchListedSpaces, toCatalogCourses } from '../../lib/catalog';
import { HttpError, encodeNextToken, handle, ok, parseLimit, parsePaging } from '../../lib/http';
import { listListedSpaces } from '../../lib/spaces';

/**
 * A search longer than this is not a search.
 *
 * The cap is also what keeps a pathological query from being handed to a scan of
 * the catalog. Nothing legitimate is 80 characters long and typed into a search
 * box on a front page.
 */
const MAX_QUERY_LENGTH = 80;

/**
 * How many results one search returns.
 *
 * Lower than the browsing page size on purpose: a search already reads further
 * into the catalog than a browse does, and every course in the answer costs
 * three count queries to describe. Somebody who searched for something specific
 * is looking at the first few results, not at the twentieth.
 */
const MAX_SEARCH_RESULTS = 24;

/**
 * The marketplace's front page: courses their authors have listed.
 *
 * Deliberately unauthenticated. A catalog that required an account to read
 * would be a catalog nobody reads — deciding whether to register for a course
 * is what happens *before* you have one — and nothing here is anybody's: it is
 * what each course says about itself in public.
 *
 * `?query=` searches it. Results come back without a `nextToken`, because a search
 * is answered from a bounded read of the catalog rather than by paging through
 * it: what a caller gets is the matches among the first few hundred published
 * courses, which is the honest thing for this to be until the catalog is big
 * enough to want a search index of its own.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const query = (event.queryStringParameters?.query ?? '').trim();

  if (query.length > MAX_QUERY_LENGTH) {
    throw new HttpError(400, `query must be <= ${MAX_QUERY_LENGTH} characters`);
  }

  if (query) {
    const matches = await searchListedSpaces(
      query,
      Math.min(parseLimit(event.queryStringParameters?.limit), MAX_SEARCH_RESULTS),
    );

    return ok({ courses: await toCatalogCourses(matches) });
  }

  const { spaces, lastEvaluatedKey } = await listListedSpaces(parsePaging(event));
  const courses = await toCatalogCourses(spaces);

  return ok({ courses, nextToken: encodeNextToken(lastEvaluatedKey) });
}

export const handler = handle(main);
