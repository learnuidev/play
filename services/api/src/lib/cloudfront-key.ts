import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { env } from './config';

const client = new SSMClient({});

/**
 * The CloudFront signing key, and the id of the key it belongs to, read from SSM
 * Parameter Store rather than from the Lambda environment.
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
 *
 * ## The id followed it here, for a reason of its own
 *
 * A CloudFront key id — the `Key-Pair-Id` a signed URL carries — is not a secret,
 * so it stayed in the environment as `CLOUDFRONT_KEY_PAIR_ID` for as long as it
 * was a plain string. It stopped being one the day a key had to be rotated: a
 * CloudFront public key is **immutable**, CloudFront's `UpdatePublicKey` rejects
 * new material outright, and the registry schema behind
 * `AWS::CloudFront::PublicKey` declares nothing as replacement-triggering — so
 * CloudFormation sends that rejected update and the deploy fails. New material
 * can only ever be a new key with a new id.
 *
 * Which is exactly what a cross-stack environment variable cannot express: the
 * id crossed from `PlayMediaStack` to `PlayApiStack` as a CDK export, and a new
 * id means a renamed export, which CloudFormation refuses to delete while the
 * consuming stack still imports it. Read from Parameter Store by name, the media
 * stack can rotate its key — create the new one, move the key group to it, delete
 * the old one, republish the id — without this service being touched at all.
 */

/** The in-flight or settled read for this container, if there has been one. */
type Reader = () => Promise<string>;

/**
 * A parameter read, done once per container.
 *
 * Caches the *promise* rather than the value, so a burst of cold-start
 * invocations in one container awaits a single `GetParameter` call instead of
 * each firing its own.
 *
 * A failed read is not remembered: the cache is cleared first so the next
 * invocation on this container tries again, rather than every request on it
 * failing with one stale error until the container is recycled.
 */
function cached(read: Reader): Reader {
  let pending: Promise<string> | undefined;
  return () => {
    pending ??= read().catch((err: unknown) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
}

/**
 * The signing key, as a PKCS#8 PEM.
 *
 * The two readers are separate promises rather than one combined
 * `GetParameters` call: they are read together on the signing path, which is the
 * only path that wants either of them, and two calls that both happen once per
 * container are not worth coupling the pair into one failure.
 */
export const cloudFrontPrivateKey: Reader = cached(readPrivateKey);

/** The CloudFront id of that key — what `Key-Pair-Id` has to carry. */
export const cloudFrontKeyPairId: Reader = cached(readKeyPairId);

async function readPrivateKey(): Promise<string> {
  const res = await client.send(
    new GetParameterCommand({
      Name: env.cloudfrontPrivateKeyParam,
      // The parameter is a SecureString, so this is what asks for the plaintext.
      // There is no `kms:Decrypt` grant beside it because the parameter is
      // encrypted with the AWS-managed `aws/ssm` key; a parameter moved to a
      // customer-managed key needs one added to the execution role in
      // `infra/src/stacks/api-stack.ts`.
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

/**
 * The key id, written by `PlayMediaStack` as it creates or imports the key.
 *
 * A signed URL whose `Key-Pair-Id` names a key the distribution's key group does
 * not trust is a 403, and one that names a key the *handlers* do not sign with is
 * a 403 too — so this and the private key above have to be the two halves of one
 * pair. Publishing the id from the stack that owns the key is what keeps them
 * together.
 */
async function readKeyPairId(): Promise<string> {
  const res = await client.send(
    new GetParameterCommand({ Name: env.cloudfrontKeyPairIdParam }),
  );

  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${env.cloudfrontKeyPairIdParam} is missing or empty`);
  }

  return value;
}
