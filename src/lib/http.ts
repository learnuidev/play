import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token, X-Amz-User-Agent',
  'Access-Control-Allow-Methods': 'OPTIONS, GET, POST, PUT, PATCH, DELETE',
};

export const ok = (data: unknown, statusCode = 200): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify(data),
});

export const noContent = (): APIGatewayProxyResult => ({
  statusCode: 204,
  headers: CORS_HEADERS,
  body: '',
});

export const fail = (statusCode: number, message: string): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify({ error: { code: statusCode, message } }),
});

type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/** Page size a listing uses when the caller does not ask for one. */
export const DEFAULT_LIMIT = 20;

/** Page size ceiling, so a single request cannot ask for a whole table. */
export const MAX_LIMIT = 100;

/**
 * Reads the page size out of the query string, clamped to the allowed range.
 */
export function parseLimit(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * Decodes a `nextToken` back into the DynamoDB `ExclusiveStartKey` it was made
 * from. The key is opaque to the client on purpose: it is a base64url of the
 * last evaluated key, so nothing about the table's key schema is part of the
 * API contract.
 */
export function parseNextToken(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Invalid nextToken');
  }
}

/** Encodes a DynamoDB `LastEvaluatedKey` as the opaque token a client passes back. */
export function encodeNextToken(key: Record<string, unknown> | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

/** Both paging parameters of a listing request, in one call. */
export function parsePaging(event: APIGatewayProxyEvent): {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
} {
  return {
    limit: parseLimit(event.queryStringParameters?.limit),
    exclusiveStartKey: parseNextToken(event.queryStringParameters?.nextToken),
  };
}

/**
 * Reads a path parameter, failing the request rather than the handler when a
 * route somehow arrives without one.
 */
export function pathParam(event: APIGatewayProxyEvent, name: string): string {
  const value = event.pathParameters?.[name];
  if (!value) throw new HttpError(400, `${name} path parameter is required`);
  return value;
}

/**
 * Reads a path parameter API Gateway has percent-decoded.
 *
 * A member is addressed by their own id, and while an invitation has not been
 * accepted that id is an email address — which arrives as `%40` in the path.
 * A malformed escape is a bad request rather than a 500, because a client can
 * send one.
 */
export function decodedPathParam(event: APIGatewayProxyEvent, name: string): string {
  const value = pathParam(event, name);
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, `Invalid ${name} path parameter`);
  }
}

/** Parses a JSON request body, treating an absent one as `{}`. */
export function jsonBody<T extends object>(event: APIGatewayProxyEvent): T {
  if (!event.body) return {} as T;
  try {
    return JSON.parse(event.body) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

/**
 * Wraps a handler with a single try/catch that converts thrown HttpErrors
 * into JSON error responses.
 */
export function handle(fn: Handler): Handler {
  return async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.statusCode, err.message);
      }
      console.error('Unhandled error', err);
      return fail(500, 'Internal server error');
    }
  };
}
