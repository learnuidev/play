import type { APIGatewayProxyEvent } from 'aws-lambda';
import { HttpError } from './http';

interface AuthorizerClaims {
  sub?: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

export interface AuthUser {
  /** Cognito `sub` — the stable identity everything is owned by. */
  userId: string;
  email?: string;
  /** Display name from the identity provider, when the pool carries one. */
  name?: string;
}

/**
 * Extracts the authenticated user from the COGNITO_USER_POOLS authorizer
 * context injected by API Gateway.
 */
export function requireUser(event: APIGatewayProxyEvent): AuthUser {
  const claims = event.requestContext.authorizer?.claims as AuthorizerClaims | undefined;
  const sub = claims?.sub;
  if (!sub) {
    throw new HttpError(401, 'Unauthorized');
  }
  return {
    userId: sub,
    ...(claims?.email ? { email: claims.email } : {}),
    ...(claims?.name ? { name: claims.name } : {}),
  };
}

/**
 * The name to show beside something the caller wrote.
 *
 * A comment keeps the author's name as it was when they wrote it, because the
 * claims are the only place this API can read one from — the members table
 * stores an email, and an identity provider is free to rename someone later
 * without rewriting what they already said.
 */
export function displayNameOf(user: AuthUser): string {
  return user.name?.trim() || user.email?.trim() || user.userId;
}

/**
 * The authenticated caller's `sub`. Videos are no longer owned by a single
 * user, so handlers authorize through `lib/access` rather than by comparing
 * this against `ownerId`.
 */
export function requireUserId(event: APIGatewayProxyEvent): string {
  return requireUser(event).userId;
}
