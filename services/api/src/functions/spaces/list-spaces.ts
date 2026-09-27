import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOrganizationAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { encodeNextToken, handle, ok, parsePaging, pathParam } from '../../lib/http';
import { listSpacesByOrganization } from '../../lib/spaces';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = pathParam(event, 'orgId');

  await requireOrganizationAccess(user.userId, orgId, 'read');

  const { spaces, lastEvaluatedKey } = await listSpacesByOrganization(orgId, parsePaging(event));

  return ok({ spaces, nextToken: encodeNextToken(lastEvaluatedKey) });
}

export const handler = handle(main);
