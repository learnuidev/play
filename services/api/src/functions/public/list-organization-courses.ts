import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { toCatalogCourses } from '../../lib/catalog';
import { HttpError, encodeNextToken, handle, ok, parsePaging, pathParam } from '../../lib/http';
import { ORGANIZATION_SCOPE, requireScope } from '../../lib/oauth-scopes';
import { listSpacesByOrganization } from '../../lib/spaces';

/**
 * A course list belonging to one organization.
 *
 * This is the one read a credential has that the public catalog does not: an
 * organization's courses whether or not their authors have published them, which
 * is what makes naming an organization on a key — or agreeing to the scope that
 * reaches one — worth doing. A partner integrating with one customer's catalog
 * gets that customer's whole catalog rather than the subset of it that is
 * advertised to the world.
 *
 * The scope is asked for first and the reach second, and the two credentials
 * answer the second question differently:
 *
 * - **A key** has to have been *made for* this organization. A key made for one
 *   organization is not a key for every organization, and the answer to the
 *   wrong one is 403 rather than an empty list, so an integration that was wired
 *   up wrong says so.
 * - **An OAuth token** acts as the person who authorized the app, so the
 *   question is what *they* may read: membership of the organization, checked
 *   the way every signed-in route checks it. The scope alone does not open the
 *   organization — an app cannot be handed a wider reach of one than the person
 *   who authorized it has.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = await requireApiCaller(event);
  requireScope(caller, ORGANIZATION_SCOPE);

  const orgId = pathParam(event, 'orgId');

  if (caller.kind === 'key') {
    if (caller.organizationId !== orgId) {
      throw new HttpError(403, 'This API key was not made for that organization');
    }
  } else {
    await requireOrganizationAccess(caller.userId, orgId, 'read');
  }

  const { spaces, lastEvaluatedKey } = await listSpacesByOrganization(orgId, parsePaging(event));

  return ok({
    courses: await toCatalogCourses(spaces),
    nextToken: encodeNextToken(lastEvaluatedKey),
  });
}

export const handler = handle(main);
