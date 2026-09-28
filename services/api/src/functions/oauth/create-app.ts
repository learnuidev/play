import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, jsonBody, ok } from '../../lib/http';
import {
  createOAuthApp,
  toOAuthApp,
  validateAppDescription,
  validateAppName,
  validateAppScopes,
  validateOptionalUrl,
  validateRedirectUris,
} from '../../lib/oauth-apps';

interface CreateAppBody {
  name?: string;
  description?: string;
  homepageUrl?: string;
  logoUrl?: string;
  redirectUris?: unknown;
  scopes?: unknown;
  isPublic?: boolean;
}

/**
 * Registers an OAuth app, and answers with its client secret exactly once.
 *
 * Any signed-in person may register one, and the app is theirs: it acts as the
 * people who authorize it rather than as its owner, so registering one grants
 * nobody anything — it is the consent screen, and the grant behind it, that
 * decides what an app may reach and whose account it reaches it on.
 *
 * **A public client gets no secret.** A browser app, a desktop app or a CLI
 * cannot keep one: the secret would ship inside the thing it is meant to
 * protect, and handing out a value that is not secret while calling it one is
 * worse than handing out nothing, because it teaches the integrator that
 * authentication is happening. A public client is authenticated by its
 * `client_id` alone and proves itself with PKCE, which every client must use
 * anyway.
 *
 * The secret is the only time the API will ever hand one over — the row holds a
 * hash — which is why the response is shaped around "copy it now" rather than
 * around the app it just made.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const body = jsonBody<CreateAppBody>(event);

  const homepageUrl = validateOptionalUrl(body.homepageUrl, 'homepageUrl');
  const logoUrl = validateOptionalUrl(body.logoUrl, 'logoUrl');

  const { record, secret } = await createOAuthApp({
    userId: user.userId,
    ...(user.email ? { userEmail: user.email } : {}),
    name: validateAppName(body.name),
    description: validateAppDescription(body.description),
    ...(homepageUrl ? { homepageUrl } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    redirectUris: validateRedirectUris(body.redirectUris),
    scopes: validateAppScopes(body.scopes),
    isPublic: body.isPublic === true,
  });

  return ok({ app: toOAuthApp(record), ...(secret ? { secret } : {}) }, 201);
}

export const handler = handle(main);
