import { Arn, ArnFormat, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

import type { PlayConfig } from '../config';

/**
 * The ARNs of the things a handler reads **by name**, and the grants that let it.
 *
 * Two stacks deploy a function of this service — `PlayApiStack` and
 * `PlayPaymentStack` — and both of them hand that function the *name* of a secret
 * or a parameter rather than its value. Which means both of them have to write an
 * ARN, and an ARN written by hand is wrong in ways that only show up in
 * production: a missing `-*` on a Secrets Manager secret is an `AccessDenied` on a
 * secret that exists, and it reads as though the secret were not there at all.
 *
 * So the two shapes live here, once, and the grant built from them lives here
 * too. That last part is not tidiness — it is a bug this repository has already
 * had: the checkout route was written to charge with the Stripe API key, the
 * *webhook* was given the grant, and the first real checkout answered 500 with
 * `not authorized to perform: secretsmanager:GetSecretValue`. One grant, one
 * place, so two halves of one feature cannot disagree about who may read the
 * credential they share.
 */

/**
 * The ARN of one SSM parameter.
 *
 * The leading slash is dropped because an ARN names the path, not a root:
 * `/play/dev/stripe/publishable-key` is
 * `arn:aws:ssm:…:parameter/play/dev/stripe/publishable-key`.
 */
export function parameterArn(scope: Construct, name: string): string {
  return Arn.format(
    {
      service: 'ssm',
      resource: 'parameter',
      resourceName: name.replace(/^\//, ''),
    },
    // `Arn.format` takes the *stack*, and a stack is what these two helpers need
    // from a caller either way: the partition, the account and the region a grant
    // is authorized in.
    Stack.of(scope),
  );
}

/**
 * The ARN pattern of one Secrets Manager secret, **suffix included**.
 *
 * Secrets Manager appends six characters to the ARN of the secret it creates —
 * `play/dev/stripe-secret-key-AbCdEf` — and `GetSecretValue` is authorized
 * against *that* ARN. A policy naming the secret as it was created does not match
 * it, and CloudFormation will deploy it happily: the failure is a 500 at the
 * first request, one deploy later, naming a secret that is right there in the
 * console.
 *
 * The colon is not the default either. `Arn.format` joins a resource and its name
 * with a slash, which is right for SSM and wrong for Secrets Manager.
 */
export function secretArn(scope: Construct, name: string): string {
  return Arn.format(
    {
      service: 'secretsmanager',
      resource: 'secret',
      resourceName: `${name}-*`,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    },
    Stack.of(scope),
  );
}

/**
 * Reading this deployment's Stripe credentials.
 *
 * **One credential, two secrets, one grant** — for both roles that need it, and
 * they need the same one:
 *
 * - `stripeCredentials()` in `services/api/src/lib/stripe.ts` reads *both* values
 *   in one call, cached per container, so a handler that only ever charges still
 *   reads the webhook signing secret on the way;
 * - the webhook verifies with the signing secret, and the checkout route creates a
 *   price and a session with the API key.
 *
 * Named secrets rather than `secretsmanager:*` on `*`: a role that can read every
 * secret in the account can read every secret in the account.
 */
export function stripeCredentialsGrant(
  scope: Construct,
  config: PlayConfig,
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    actions: ['secretsmanager:GetSecretValue'],
    resources: [
      secretArn(scope, config.stripeSecretName),
      secretArn(scope, config.stripeWebhookSecretName),
    ],
  });
}
