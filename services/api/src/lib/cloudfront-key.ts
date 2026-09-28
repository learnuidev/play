import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { env } from './config';

const client = new SSMClient({});

/**
 * The CloudFront signing key, read from SSM Parameter Store rather than from the
 * Lambda environment.
 *
 * It used to be handed to every function as `CLOUDFRONT_PRIVATE_KEY`. That is
 * 2.3 KB of a 4 KB environment, and the service has a hundred functions: the
 * shared environment was at 3.9 KB before the API-key table added one more
 * variable and pushed the deploy over the limit. The key is also the one thing
 * in that environment that is a secret — an environment variable is readable in
 * the console and in `lambda get-function-configuration`, which meant every
 * function, including the key list, was carrying a copy of
 * the distribution's signing key it would never use.
 *
 * So it is fetched from the parameter the deployment used to interpolate at
 * package time, and the environment carries only its *name*.
 */

/** The in-flight or settled read for this container, if there has been one. */
let pending: Promise<string> | undefined;

/**
 * The signing key, as a PKCS#8 PEM.
 *
 * Caches the *promise* rather than the value, so a burst of cold-start
 * invocations in one container awaits a single `GetParameter` call instead of
 * each firing its own.
 *
 * A failed read is not remembered: the cache is cleared first so the next
 * invocation on this container tries again, rather than every request on it
 * failing with one stale error until the container is recycled.
 */
export function cloudFrontPrivateKey(): Promise<string> {
  pending ??= readPrivateKey().catch((err: unknown) => {
    pending = undefined;
    throw err;
  });

  return pending;
}

async function readPrivateKey(): Promise<string> {
  const res = await client.send(
    new GetParameterCommand({
      Name: env.cloudfrontPrivateKeyParam,
      // The parameter is a SecureString, so this is what asks for the plaintext.
      // There is no `kms:Decrypt` grant beside it because the parameter is
      // encrypted with the AWS-managed `aws/ssm` key; a parameter moved to a
      // customer-managed key needs one added to the role in serverless.yml.
      WithDecryption: true,
    }),
  );

  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${env.cloudfrontPrivateKeyParam} is missing or empty`);
  }

  // Stored base64-encoded by scripts/generate-cloudfront-keypair.sh, which is
  // also how it used to arrive through the environment.
  return Buffer.from(value, 'base64').toString('utf8');
}
