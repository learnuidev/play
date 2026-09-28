import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireApiCaller } from '../../lib/auth';
import { requireScope } from '../../lib/oauth-scopes';
import { searchListedSpaces, toCatalogCourses } from '../../lib/catalog';
import { HttpError, encodeNextToken, handle, ok, parseLimit, parsePaging } from '../../lib/http';
import { listListedSpaces } from '../../lib/spaces';

/** The same caps the marketplace's own catalog read uses, and for the same reasons. */
const MAX_QUERY_LENGTH = 80;
const MAX_SEARCH_RESULTS = 24;

/**
 * The published catalog, to a key or an authorized app.
 *
 * The same courses `GET /catalog/courses` serves to anybody, with the same
 * search, reached the other way: that route is open to the world and this one
 * asks for a credential. Neither is more privileged than the other — the catalog
 * is public — and the reason both exist is that a partner integrating with the
 * API wants one base URL and one way in, while the marketplace's front page
 * wants to render for a visitor who has not signed in.
 *
 * `courses:read`, which every credential holds unless its owner narrowed it away
 * — an app registered for `profile:read` alone is refused here, and told which
 * scope it is missing.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  requireScope(requireApiCaller(event), 'courses:read');

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

  return ok({
    courses: await toCatalogCourses(spaces),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
