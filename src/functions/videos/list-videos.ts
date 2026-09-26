import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUserId } from '../../lib/auth';
import { requireOrganizationAccess } from '../../lib/access';
import { listVideosByOrganization, listVideosByOwner } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { VIDEO_STATUSES, type VideoStatus } from '../../types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseToken(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid nextToken');
  }
}

function parseLimit(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);

  const statusParam = event.queryStringParameters?.status;
  const organizationId = event.queryStringParameters?.organizationId?.trim();
  const limit = parseLimit(event.queryStringParameters?.limit);
  const exclusiveStartKey = parseToken(event.queryStringParameters?.nextToken);

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
    result = await listVideosByOrganization(organizationId, { status, limit, exclusiveStartKey });
  } else {
    result = await listVideosByOwner(userId, { status, limit, exclusiveStartKey });
  }

  return ok({
    videos: result.videos,
    nextToken: result.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64url')
      : undefined,
  });
}

export const handler = handle(main);
