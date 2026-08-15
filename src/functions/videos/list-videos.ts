import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { listVideosByOwner } from '../../lib/dynamodb';
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

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);

  const statusParam = event.queryStringParameters?.status;
  const limit = Math.min(Number(event.queryStringParameters?.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const exclusiveStartKey = parseToken(event.queryStringParameters?.nextToken);

  let status: VideoStatus | undefined;
  if (statusParam) {
    if (!VIDEO_STATUSES.includes(statusParam as VideoStatus)) {
      throw new HttpError(400, `status must be one of: ${VIDEO_STATUSES.join(', ')}`);
    }
    status = statusParam as VideoStatus;
  }

  const { videos, lastEvaluatedKey } = await listVideosByOwner(ownerId, {
    status,
    limit,
    exclusiveStartKey,
  });

  return ok({
    videos,
    nextToken: lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url')
      : undefined,
  });
}

export const handler = handle(main);
