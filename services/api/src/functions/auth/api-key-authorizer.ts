import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';
import { findApiKeyBySecret, touchApiKey } from '../../lib/api-keys';

/**
 * `principalId` on a rejection, which API Gateway requires to be a string even
 * when the answer is no. Named rather than empty so a CloudWatch log line about
 * a refused request says which of the two answers it was.
 */
const REJECTED_PRINCIPAL = 'unauthenticated';

/**
 * The authorizer behind `/v1`: it turns an `x-api-key` header into an identity.
 *
 * A REQUEST authorizer rather than a TOKEN authorizer, and ours rather than API
 * Gateway's built-in keys. API Gateway's own keys are attached to a usage plan
 * at deploy time — an operator's control, provisioned with the API — while these
 * are objects a person makes for themselves in the studio, which is the whole
 * feature. The request form (rather than the token form) is what lets the header
 * be read without pretending it is a bearer token.
 *
 * **Nothing is cached** (`resultTtlInSeconds: 0` on the route). That is a
 * deliberate cost: the alternative is a revocation that takes up to an hour to
 * take effect, and "I cut the key off" has to mean it stopped working. The price
 * is one DynamoDB read per call, which is what identifying the caller costs
 * everywhere else in this service too.
 *
 * A bad key is answered with a **Deny policy**, not with a thrown error. API
 * Gateway has three documented answers here and only two of them are decisions:
 * a Deny policy is a 403, a thrown error is a 500, and the one case this
 * function never sees — no header at all — is a 401 from API Gateway itself,
 * because the route declares `x-api-key` as its identity source.
 */
export async function handler(
  event: APIGatewayRequestAuthorizerEvent,
): Promise<APIGatewayAuthorizerResult> {
  const secret = presentedKey(event.headers);

  // One lookup, and its absence is the whole answer: a secret that matches no
  // row is a key that was never made, or one that has since been revoked and
  // deleted. Distinguishing those would tell a caller holding a wrong key
  // whether a right one once existed, which is nothing they need to know.
  const record = secret ? await findApiKeyBySecret(secret) : undefined;
  if (!record) {
    return policy(event.methodArn, 'Deny', REJECTED_PRINCIPAL);
  }

  // Recorded here rather than in each handler: this is the one place every
  // authenticated call passes through.
  await touchApiKey(record.keyId);

  return {
    ...policy(event.methodArn, 'Allow', record.userId),
    context: {
      keyId: record.keyId,
      userId: record.userId,
      // Empty rather than absent when the key has no organization: the context
      // values API Gateway forwards are strings, and an omitted key reads back
      // as `undefined` from a field that is always there.
      organizationId: record.organizationId ?? '',
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
 * The secret in the request's headers, if there is one.
 *
 * `x-api-key` is the documented header, and the one the route names as its
 * identity source. Header names arrive in whatever case the caller sent — a cURL
 * on the other side of the wire sends `X-Api-Key` — so the lookup is over a
 * lower-cased copy rather than over the exact spelling the docs use.
 */
function presentedKey(headers: Record<string, string | undefined> | null): string | undefined {
  const lowered: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    lowered[name.toLowerCase()] = value;
  }

  const secret = lowered['x-api-key']?.trim();
  return secret ? secret : undefined;
}
