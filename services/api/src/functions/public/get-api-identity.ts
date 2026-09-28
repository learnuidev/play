import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getApiKey, toApiKey } from '../../lib/api-keys';
import { requireApiCaller } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';
import { getOAuthApp, toAppSummary } from '../../lib/oauth-apps';
import { formatScopeList } from '../../lib/oauth-scopes';
import type { ApiIdentityResponse } from '../../types';

/**
 * Who the presented credential is.
 *
 * The first call anybody makes with a new credential, and the one that answers
 * the two questions its holder has: does this work, and what does it reach. It
 * answers for both kinds — an API key and an OAuth access token — because "does
 * this work" is the same question either way.
 *
 * **It needs no scope**, and that is the whole point of it. A credential that
 * has run out of permission still has to be able to find out *whose* it is and
 * what it holds, or an integration cannot tell "my token expired" apart from "I
 * was never allowed to do that". What it does not do is volunteer anything about
 * the person: a profile is `GET /v1/me/profile`, and it takes `profile:read`,
 * because a name and a face are things somebody agreed to share and not
 * something every credential may help itself to.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = await requireApiCaller(event);

  if (caller.kind === 'key') {
    const record = await getApiKey(caller.keyId);
    // It authenticated a moment ago and is gone now: revoked between the
    // authorizer and here. The key is no longer a key, so the answer is the same
    // one an unknown key gets rather than a server error.
    if (!record) throw new HttpError(401, 'Unauthorized');

    const body: ApiIdentityResponse = {
      kind: 'key',
      key: toApiKey(record),
      owner: { userId: record.userId },
      scopes: caller.scopes,
    };
    return ok(body);
  }

  const app = await getOAuthApp(caller.appId);
  if (!app) throw new HttpError(401, 'Unauthorized');

  const body: ApiIdentityResponse = {
    kind: 'oauth',
    oauth: {
      app: toAppSummary(app),
      scopes: caller.scopes,
      scope: formatScopeList(caller.scopes),
    },
    owner: { userId: caller.userId },
    scopes: caller.scopes,
  };
  return ok(body);
}

export const handler = handle(main);
