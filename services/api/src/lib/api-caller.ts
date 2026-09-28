import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { ApiCaller, ApiScope } from '../types';
import { findApiKeyBySecret, touchApiKey } from './api-keys';
import { touchGrant } from './oauth-grants';
import { KEY_SCOPES, ORGANIZATION_SCOPE } from './oauth-scopes';
import { findAccessToken } from './oauth-tokens';

/**
 * The one place a `/v1` credential becomes an identity.
 *
 * Two kinds of caller reach the public API and they arrive in two different
 * headers: an **API key** in `x-api-key` — a credential somebody made for a
 * script, which acts as them and reaches the slice keys have always reached —
 * and an **OAuth access token** as `Authorization: Bearer …` — a credential
 * minted because a person authorized somebody else's app, which acts as them and
 * reaches exactly the scopes they agreed to.
 *
 * ## Why this is a function and not an authorizer
 *
 * It was a Lambda authorizer (an API Gateway `REQUEST` authorizer) until it had
 * to accept two headers, and API Gateway cannot express that. Every mapping
 * expression it is given as an `identitySource` is validated on **every**
 * request — all of them must be present, non-null and non-empty, or API Gateway
 * answers 401 itself without invoking anything. The API reference is explicit
 * that this is unconditional, and only the *property* is optional when caching
 * is off:
 *
 * > These parameters will be used to derive the authorization caching key and to
 * > perform runtime validation of the REQUEST authorizer by verifying all of the
 * > identity-related request parameters are present, not null and non-empty.
 * > Only when this is true does the authorizer invoke the authorizer Lambda
 * > function, otherwise, it returns a 401 Unauthorized response without calling
 * > the Lambda function.
 *
 * So declaring `method.request.header.Authorization, method.request.header.x-api-key`
 * means "a caller must send both", which no real caller does: keys got a 401 for
 * lacking `Authorization`, and access tokens got a 401 for lacking `x-api-key`.
 * There is no identity source meaning "either", and no header both kinds of
 * caller send. A credential in one of two headers is therefore decided *after*
 * the gateway, in the one function every `/v1` handler already calls before it
 * does anything else.
 *
 * What that trades away is the gateway refusing an unauthenticated request
 * before Lambda runs. What it buys is a refusal in this API's own error shape
 * (`{error:{code,message}}`) rather than API Gateway's bare
 * `{"message":"Unauthorized"}`, which is the shape an integration can actually
 * read — and one implementation of "how a credential becomes an identity"
 * instead of two.
 *
 * Nothing is cached, here as before: one DynamoDB read per call, which is what
 * identifying a caller costs everywhere else in this service, and what makes
 * revocation take effect on the next request rather than within the hour.
 */

/**
 * What an API key starts with, and what an OAuth access token starts with.
 *
 * The credential's own prefix decides how it is looked up, so a string that is
 * neither is refused **without reading the database at all** — the right price
 * for a credential that was never going to authenticate, and what lets the two
 * kinds be told apart in a log line by somebody who has the line and nothing
 * else.
 */
const API_KEY_PREFIX = 'play_sk_';
const ACCESS_TOKEN_PREFIX = 'play_at_';

/**
 * The caller behind a `/v1` request, or nothing when the credential does not
 * resolve.
 *
 * Returning `undefined` rather than throwing is what lets the caller decide the
 * answer: `requireApiCaller` turns it into a 401, and nothing else has an
 * opinion about it. A rejected credential and an absent one are deliberately the
 * same answer — a caller holding a wrong key is not told whether a right one
 * ever existed.
 */
export async function resolveApiCaller(
  event: APIGatewayProxyEvent,
): Promise<ApiCaller | undefined> {
  const credential = presentedCredential(event);
  if (!credential) return undefined;

  if (credential.startsWith(ACCESS_TOKEN_PREFIX)) {
    return resolveAccessToken(credential);
  }
  if (credential.startsWith(API_KEY_PREFIX)) {
    return resolveApiKey(credential);
  }

  return undefined;
}

/**
 * An OAuth access token, as the identity it acts as.
 *
 * The scopes come from the token's own row, which is the scopes a person agreed
 * to on a consent screen — and they travel as the space-delimited list OAuth
 * already writes them in, parsed back by `lib/oauth-scopes`. Nothing is enforced
 * here: this answers *who* is calling, and each handler asks whether the caller
 * holds the scope its route needs. Which route needs which scope is a fact about
 * the route, and a fact about a route belongs beside the route rather than in a
 * table a new endpoint can be added without updating.
 *
 * The grant's `lastUsedAt` is written at most once per refresh window, so the
 * connections screen can say when an app was last used without every call to
 * this API being a write.
 */
async function resolveAccessToken(secret: string): Promise<ApiCaller | undefined> {
  const record = await findAccessToken(secret);
  if (!record) return undefined;

  await touchGrant(record.userId, record.appId);

  return {
    kind: 'oauth',
    appId: record.appId,
    clientId: record.clientId,
    userId: record.userId,
    scopes: record.scopes,
  };
}

/**
 * An API key, as the identity it acts as.
 *
 * Read rather than compared: the row is found by the hash of the presented
 * secret, so an unknown key is one query that returns nothing. A key's scopes
 * are not stored on it — they are what a key has always reached, expressed in
 * the vocabulary the OAuth side uses, so that a handler asks one question of
 * either credential: see `KEY_SCOPES`.
 */
async function resolveApiKey(secret: string): Promise<ApiCaller | undefined> {
  const record = await findApiKeyBySecret(secret);
  if (!record) return undefined;

  await touchApiKey(record.keyId);

  const scopes: ApiScope[] = record.organizationId
    ? [...KEY_SCOPES, ORGANIZATION_SCOPE]
    : [...KEY_SCOPES];

  return {
    kind: 'key',
    keyId: record.keyId,
    userId: record.userId,
    scopes,
    ...(record.organizationId ? { organizationId: record.organizationId } : {}),
  };
}

/**
 * The credential in the request, whichever header it is in.
 *
 * `Authorization: Bearer` is read first, and it wins when both are present: it
 * is the standard header, it is what every OAuth client sends, and a request
 * carrying both is a client that has been reconfigured without being cleaned
 * up — the newer credential is the one it means.
 *
 * `x-api-key` is the header the keys screen has always documented. A key
 * presented as a bearer token works too, because the prefix is what decides how
 * the credential is looked up and not the header it arrived in: an integration
 * that would rather send every credential the same way is not doing anything
 * wrong.
 *
 * Header names arrive in whatever case the caller sent — a cURL on the other
 * side of the wire sends `X-Api-Key` — so the lookup is over a lower-cased copy
 * rather than over the exact spelling the docs use.
 */
function presentedCredential(event: APIGatewayProxyEvent): string | undefined {
  const lowered: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    lowered[name.toLowerCase()] = value;
  }

  const authorization = lowered['authorization']?.trim();
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (match) return match[1].trim();
  }

  const apiKey = lowered['x-api-key']?.trim();
  return apiKey ? apiKey : undefined;
}
