import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import {
  requireOwnedApp,
  toOAuthApp,
  updateOAuthApp,
  validateAppDescription,
  validateAppName,
  validateAppScopes,
  validateOptionalUrl,
  validateRedirectUris,
} from '../../lib/oauth-apps';
import { deleteGrantsForApp } from '../../lib/oauth-grants';

interface UpdateAppBody {
  name?: string;
  description?: string;
  /** `null` clears it; absent leaves it alone. */
  homepageUrl?: string | null;
  logoUrl?: string | null;
  redirectUris?: unknown;
  scopes?: unknown;
}

/**
 * Edits one of the caller's own apps.
 *
 * Only the fields sent are written, and `null` clears an optional one — the
 * convention the profile screen already uses, because a form that sends what
 * changed must not be able to erase what it did not mention.
 *
 * **Changing the scopes ends every authorization of the app.** That is the one
 * surprising rule here, and it is the only honest one: a person agreed to a
 * particular list of permissions printed on a screen, and an app whose list has
 * changed is not the app they agreed to. Two alternatives were considered and
 * both are worse — keeping old tokens on their old scopes means an app can
 * quietly hold a permission its registration no longer mentions, and applying
 * the change to live tokens means a token's reach changes underneath a call that
 * is in flight. Ending the authorizations means the next visit shows the consent
 * screen again, with the new list on it.
 *
 * Edits that do not touch the scopes — a name, a redirect URI, a logo — leave
 * every connection alone, which is what makes it safe to fix a typo.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const appId = pathParam(event, 'appId');
  const body = jsonBody<UpdateAppBody>(event);

  const existing = await requireOwnedApp(user.userId, appId);

  const redirectUris =
    body.redirectUris === undefined ? undefined : validateRedirectUris(body.redirectUris);
  const scopes = body.scopes === undefined ? undefined : validateAppScopes(body.scopes);

  // Compared as sets: a form that sends the same scopes back in a different
  // order is not a change, and must not disconnect everybody.
  const scopesChanged =
    scopes !== undefined &&
    (scopes.length !== existing.scopes.length ||
      scopes.some((scope) => !existing.scopes.includes(scope)));

  // End the authorizations **before** the new registration is written, and the
  // order is about what a retry does rather than about the happy path. A scope
  // change is destructive and it is not transactional: if the sweep ran second
  // and failed, the app would already be registered for scopes nobody has
  // consented to, and the owner's next save would compute `scopesChanged` as
  // false — the sweep would never run, and tokens holding a permission the app
  // no longer registers would stay valid for their refresh token's whole month.
  // This way a failure leaves the change still to be made: the owner saves
  // again, and the same work happens again.
  const authorizationsEnded = scopesChanged ? await deleteGrantsForApp(appId) : 0;

  const record = await updateOAuthApp(appId, {
    ...(body.name !== undefined ? { name: validateAppName(body.name) } : {}),
    ...(body.description !== undefined
      ? { description: validateAppDescription(body.description) }
      : {}),
    ...(body.homepageUrl !== undefined
      ? { homepageUrl: validateOptionalUrl(body.homepageUrl ?? '', 'homepageUrl') ?? null }
      : {}),
    ...(body.logoUrl !== undefined
      ? { logoUrl: validateOptionalUrl(body.logoUrl ?? '', 'logoUrl') ?? null }
      : {}),
    ...(redirectUris ? { redirectUris } : {}),
    ...(scopes ? { scopes } : {}),
  });

  return ok({
    app: toOAuthApp(record),
    // Only when it happened, so a caller that did not touch the scopes gets a
    // response shaped exactly like the one it has always got.
    ...(scopesChanged ? { authorizationsEnded } : {}),
  });
}

export const handler = handle(main);
