import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';
import { listOrganizationsForUser } from '../../lib/organizations';

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
  const user = requireUser(event);

  const requested = Number(event.queryStringParameters?.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
  const exclusiveStartKey = parseToken(event.queryStringParameters?.nextToken);

  const { organizations, lastEvaluatedKey } = await listOrganizationsForUser(user.userId, {
    limit,
    exclusiveStartKey,
  });

  return ok({
    organizations,
    nextToken: lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url')
      : undefined,
  });
}

export const handler = handle(main);
