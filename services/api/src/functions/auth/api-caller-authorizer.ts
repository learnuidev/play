import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { findApiKeyBySecret, touchApiKey } from '../../lib/api-keys';
import { touchGrant } from '../../lib/oauth-grants';
import { KEY_SCOPES, ORGANIZATION_SCOPE, formatScopeList } from '../../lib/oauth-scopes';
import { findAccessToken } from '../../lib/oauth-tokens';
import type { ApiScope } from '../../types';

/**
 * `principalId` on a rejection, which API Gateway requires to be a string even
 * when the answer is no. Named rather than empty so a CloudWatch log line about
 * a refused request says which of the two answers it was.
 */
const REJECTED_PRINCIPAL = 'unauthenticated';

/**
 * What an API key starts with, and what an OAuth access token starts with.
 *
 * The authorizer routes on the prefix rather than trying both lookups, and the
 * difference shows up in the worst case: a request presenting a string that is
 * neither is refused **without reading the database at all**, which is the right
 * price for a credential that was never going to authenticate. It is also what
 * lets the two credential kinds be told apart in a log line by somebody who has
 * the line and nothing else.
 */
const API_KEY_PREFIX = 'play_sk_';
const ACCESS_TOKEN_PREFIX = 'play_at_';

/**
 * The authorizer behind `/v1`: it turns a credential into an identity.
 *
 * Two kinds of caller reach the public API, and they arrive as two different
 * headers:
 *
 * - an **API key** in `x-api-key` — a credential a person made for a script,
 *   which acts as them and reaches the fixed slice keys have always reached;
 * - an **OAuth access token** as `Authorization: Bearer …` — a credential minted
 *   because a person authorized somebody else's app, which acts as them and
 *   reaches exactly the scopes they agreed to.
 *
 * Both are resolved here, in one function, because both are the answer to one
 * question — who is calling — and because the alternative, two authorizers, is
 * not available: API Gateway allows one authorizer per method, and `/v1` is one
 * set of routes that must accept either credential.
 *
 * ## Why one identity source is a header we may ignore
 *
 * This authorizer declares `Authorization` and `x-api-key` as its identity
 * sources, and it is worth knowing why that does not lock either caller out.
 * API Gateway verifies that every identity source is present only when
 * authorization **caching is on**, and returns 401 itself if one is missing; and
 * the cache here is off (`resultTtlInSeconds: 0`), because a revocation that
 * takes up to an hour to take effect is not a revocation. With caching off the
 * request goes straight to this function, headers and all, and this function
 * decides. That is what makes a Bearer-only request and an `x-api-key`-only
 * request the same kind of request here.
 *
 * A request presenting **neither** is refused with a Deny policy, which is a
 * 403. That is the one behaviour that changed when this authorizer grew its
 * second credential: a missing `x-api-key` used to be a 401 from API Gateway
 * before this function ran. The distinction that matters is unchanged and is the
 * one below — a bad credential is a Deny policy — and 403 is what "you are not
 * who you say you are" has always been answered with here.
 *
 * **Nothing is cached**, which is the deliberate cost this service pays for
 * immediate revocation: one DynamoDB read per call, which is what identifying a
 * caller costs everywhere else here too.
 */
export async function handler(
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> {
  const credential = presentedCredential(event.headers);
  if (!credential) return policy(event.methodArn, 'Deny', REJECTED_PRINCIPAL);

  if (credential.startsWith(ACCESS_TOKEN_PREFIX)) {
    return authorizeAccessToken(event, credential);
  }
  if (credential.startsWith(API_KEY_PREFIX)) {
    return authorizeApiKey(event, credential);
  }

  return policy(event.methodArn, 'Deny', REJECTED_PRINCIPAL);
}

/**
 * An OAuth access token, as the identity it acts as.
 *
 * The scopes on the token travel to the handler in the authorizer's context,
 * which is a map of strings — so they go as the space-delimited list OAuth
 * already writes them in, and `lib/oauth-scopes` reads them back. Nothing is
 * enforced here: this function answers *who* is calling, and each handler asks
 * whether the caller holds the scope the route needs. Which route needs which
 * scope is a fact about the route, and a fact about a route belongs beside the
 * route rather than in a table a new endpoint can be added without updating.
 *
 * The grant's `lastUsedAt` is written at most once per refresh window, so the
 * connections screen can say when an app was last used without every call to
 * this API being a write.
 */
async function authorizeAccessToken(
  event: APIGatewayRequestAuthorizerEvent,
  secret: string,
): Promise<APIGatewayAuthorizerResult> {
  const record = await findAccessToken(secret);
  if (!record) return policy(event.methodArn, 'Deny', REJECTED_PRINCIPAL);

  await touchGrant(record.userId, record.appId);

  return {
    ...policy(event.methodArn, 'Allow', record.userId),
    context: {
      kind: 'oauth',
      userId: record.userId,
      appId: record.appId,
      clientId: record.clientId,
      scopes: formatScopeList(record.scopes),
    },
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
async function authorizeApiKey(
  event: APIGatewayRequestAuthorizerEvent,
  secret: string,
): Promise<APIGatewayAuthorizerResult> {
  const record = await findApiKeyBySecret(secret);
  if (!record) return policy(event.methodArn, 'Deny', REJECTED_PRINCIPAL);

  // Recorded here rather than in each handler: this is the one place every
  // authenticated call passes through.
  await touchApiKey(record.keyId);

  const scopes: ApiScope[] = record.organizationId
    ? [...KEY_SCOPES, ORGANIZATION_SCOPE]
    : [...KEY_SCOPES];

  return {
    ...policy(event.methodArn, 'Allow', record.userId),
    context: {
      kind: 'key',
      keyId: record.keyId,
      userId: record.userId,
      // Empty rather than absent when the key has no organization: the context
      // values API Gateway forwards are strings, and an omitted key reads back
      // as `undefined` from a field that is always there.
      organizationId: record.organizationId ?? '',
      scopes: formatScopeList(scopes),
    },
  };
}

/**
 * The IAM policy API Gateway authorizes the call with.
 *
 * The resource is the one method that was invoked, and no wider: a policy naming
 * the whole stage would make this authorizer a grant to every route in the
 * service, including the signed-in ones it is not attached to.
 */
function policy(
  methodArn: string,
  effect: 'Allow' | 'Deny',
  principalId: string,
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: methodArn }],
    },
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
function presentedCredential(
  headers: Record<string, string | undefined> | null,
): string | undefined {
  const lowered: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
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
