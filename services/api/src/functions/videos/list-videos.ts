import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { requireOrganizationAccess } from '../../lib/access';
import { listVideosByOrganization, listVideosByOwner } from '../../lib/dynamodb';
import { HttpError, encodeNextToken, handle, ok, parsePaging } from '../../lib/http';
import { VIDEO_STATUSES, type VideoStatus } from '../../types';

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const statusParam = event.queryStringParameters?.status;
  const organizationId = event.queryStringParameters?.organizationId?.trim();
  const paging = parsePaging(event);

  let status: VideoStatus | undefined;
  if (statusParam) {
    if (!VIDEO_STATUSES.includes(statusParam as VideoStatus)) {
      throw new HttpError(400, `status must be one of: ${VIDEO_STATUSES.join(', ')}`);
    }
    status = statusParam as VideoStatus;
  }

  // With `organizationId` this is the organization's library, which every
  // member can see; without it, it is the caller's own uploads.
  let result;
  if (organizationId) {
    await requireOrganizationAccess(userId, organizationId, 'read');
    result = await listVideosByOrganization(organizationId, { ...paging, status });
  } else {
    result = await listVideosByOwner(userId, { ...paging, status });
  }

  return ok({ videos: result.videos, nextToken: encodeNextToken(result.lastEvaluatedKey) });
}

export const handler = handle(main);
