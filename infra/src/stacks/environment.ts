import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

import type { PlayConfig } from '../config';
import { TABLES } from '../generated/service';

/**
 * The environment every handler in this service is handed.
 *
 * It is a **budget**, not a convenience: Lambda caps a function's environment
 * at 4 KB, and because every function that serves a route gets the same map, one
 * addition spends it collectively. That is why the CloudFront private key — 2.3
 * KB of a 4 KB limit — is a *parameter name* here rather than the key itself, and
 * why a large or secret value belongs in Parameter Store with only its name in
 * this map.
 *
 * The table names are read from the table objects rather than from the config
 * file, so an imported table and a created one are the same code path.
 *
 * ## Why this is a module rather than a method on the API stack
 *
 * Because a second stack deploys a handler now. `PlayPaymentStack` owns the
 * Stripe webhook, and the handler is an ordinary member of this service: it
 * imports the same `lib/` the routes do, and those modules read their
 * configuration out of this map at the moment they are loaded. Handing it a
 * *narrower* environment would mean either a `lib/config` that reads lazily —
 * a change to a file 36 modules depend on, which is a thing to do on purpose
 * rather than in passing — or a handler that cannot call `enrollInSpace`,
 * which is the one thing a payment is *for*. So the webhook gets this map, and
 * what it may actually *do* with it is bounded by its role instead: it is
 * granted two tables and one secret, and the media ARNs and bucket name in here
 * are inert strings to a function with no permission to touch them.
 */
export interface ServiceEnvironmentInput {
  /** A name, not the bucket object — see the note on the API stack's refs. */
  videosBucketName: string;
  distributionDomain: string;
  /** A token, because the role is created by the media stack. */
  mediaConvertRoleArn: string;
  /** A token, because the role is created by the media stack. */
  transcribeRoleArn: string;
}

export function serviceEnvironment(
  config: PlayConfig,
  tables: Record<string, dynamodb.ITable>,
  media: ServiceEnvironmentInput,
): Record<string, string> {
  const tableEnvironment: Record<string, string> = {};
  for (const spec of TABLES) {
    const table = tables[spec.id];
    if (!table) {
      throw new Error(
        `${spec.id} is in the generated service table but not in the data stack, so ` +
          `${spec.envVar} cannot be put in the environment every handler reads it from`,
      );
    }
    tableEnvironment[spec.envVar] = table.tableName;
  }

  return {
    ...tableEnvironment,
    VIDEOS_BUCKET: media.videosBucketName,
    CLOUDFRONT_DOMAIN: media.distributionDomain,
    // The *name* of the parameter holding the key id rather than the id: the
    // id is CloudFront-assigned and changes when the key is rotated, and a
    // value that changes is a value that cannot cross stacks without dragging a
    // CloudFormation export behind it.
    CLOUDFRONT_KEY_PAIR_ID_PARAM: config.cloudFrontPublicKeyIdParam,
    CLOUDFRONT_PRIVATE_KEY_PARAM: config.cloudFrontPrivateKeyParam,
    MEDIACONVERT_ROLE_ARN: media.mediaConvertRoleArn,
    TRANSCRIBE_ROLE_ARN: media.transcribeRoleArn,
    SUBTITLE_LANGUAGE: 'en-US',
    STREAM_URL_TTL_SECONDS: '900',
    MAIL_FROM_ADDRESS: config.mail.fromAddress,
    APP_BASE_URL: config.mail.appBaseUrl,
    MARKETPLACE_BASE_URL: config.mail.marketplaceBaseUrl,
    // Where this deployment's Stripe credentials live — **names, not values**,
    // like the CloudFront key pair above. Any handler in this service may need
    // them: the webhook verifies with the signing secret, and the route that
    // creates a checkout session pays with the API key. What each of them may
    // *read* is its own role's business, and no value appears here — a credential
    // in a function's environment is a credential readable from the Lambda console
    // by anybody who can read a function.
    STRIPE_SECRET_NAME: config.stripeSecretName,
    STRIPE_WEBHOOK_SECRET_NAME: config.stripeWebhookSecretName,
    STRIPE_PUBLISHABLE_KEY_PARAM: config.stripePublishableKeyParam,
    AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED: 'true',
  };
}
