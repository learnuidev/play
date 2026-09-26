import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';
import { getMembership, getOrganization } from '../../lib/organizations';
import type { OrganizationSummary } from '../../types';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const orgId = event.pathParameters?.orgId;

  if (!orgId) throw new HttpError(400, 'orgId path parameter is required');

  const organization = await getOrganization(orgId);
  if (!organization) throw new HttpError(404, 'Organization not found');

  // The membership row is the authorization check — being able to see the
  // organization is exactly what membership means.
  const membership = await getMembership(orgId, user.userId);
  if (!membership) throw new HttpError(403, 'Forbidden');

  const summary: OrganizationSummary = { ...organization, role: membership.role };
  return ok({ organization: summary });
}

export const handler = handle(main);
