import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getApiKey, revokeApiKey } from '../../lib/api-keys';
import { requireOrganizationAdmin } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';

/**
 * Deletes one of the organization's keys, whoever made it.
 *
 * The key has to belong to *this* organization rather than merely exist: the
 * route is the organization's, and an admin of one organization is nobody's
 * admin in the next. A key outside it answers 404, which is the same answer a
 * key id that does not exist gets — and the same answer one already revoked
 * gets, because there is no longer a row to tell them apart.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');
  const keyId = pathParam(event, 'keyId');

  await requireOrganizationAdmin(user.userId, orgId);

  const existing = await getApiKey(keyId);
  if (!existing || existing.organizationId !== orgId) {
    throw new HttpError(404, 'API key not found');
  }

  if (!(await revokeApiKey(keyId))) {
    throw new HttpError(404, 'API key not found');
  }

  return noContent();
}

export const handler = handle(main);
