import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = event.pathParameters?.spaceId;

  if (!spaceId) throw new HttpError(400, 'spaceId path parameter is required');

  const space = await requireSpaceAccess(spaceId, userId, 'read');

  return ok({ space });
}

export const handler = handle(main);
