import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { listBanksByOrganization } from '../../lib/question-banks';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * An organization's question banks, oldest first.
 *
 * Read by any active member — a bank is where a colleague's questions are, and
 * reading them is how somebody checks them — while changing one takes an editor
 * or an admin. That split is the same one the video library uses, for the same
 * reason: material an organization owns is read widely and written narrowly.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const orgId = pathParam(event, 'orgId');

  await requireOrganizationAccess(userId, orgId, 'read');

  return ok({ banks: await listBanksByOrganization(orgId) });
}

export const handler = handle(main);
