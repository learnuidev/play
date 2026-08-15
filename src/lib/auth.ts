import type { APIGatewayProxyEvent } from 'aws-lambda';
import { HttpError } from './http';

interface AuthorizerClaims {
  sub?: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Extracts the authenticated Cognito user's `sub` (owner id) from the
 * COGNITO_USER_POOLS authorizer context injected by API Gateway.
 */
export function requireOwnerId(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext.authorizer?.claims as AuthorizerClaims | undefined;
  const sub = claims?.sub;
  if (!sub) {
    throw new HttpError(401, 'Unauthorized');
  }
  return sub;
}
