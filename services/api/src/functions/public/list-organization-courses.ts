import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireApiKeyCaller } from '../../lib/auth';
import { toCatalogCourses } from '../../lib/catalog';
import { HttpError, encodeNextToken, handle, ok, parsePaging, pathParam } from '../../lib/http';
import { listSpacesByOrganization } from '../../lib/spaces';

/**
 * A course list belonging to one organization, to a key made for it.
 *
 * This is the one read a key has that the public catalog does not: an
 * organization's courses whether or not their authors have published them,
 * which is what makes naming an organization on a key worth doing. A partner
 * integrating with one customer's catalog gets that customer's whole catalog
 * rather than the subset of it that is advertised to the world.
 *
 * The key is checked against the organization in the path rather than trusted to
 * reach whichever one it names: a key made for one organization is not a key for
 * every organization, and the answer to the wrong one is 403 rather than an
 * empty list, so an integration that was wired up wrong says so.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = requireApiKeyCaller(event);
  const orgId = pathParam(event, 'orgId');

  if (caller.organizationId !== orgId) {
    throw new HttpError(403, 'This API key was not made for that organization');
  }

  const { spaces, lastEvaluatedKey } = await listSpacesByOrganization(orgId, parsePaging(event));

  return ok({
    courses: await toCatalogCourses(spaces),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
