import type { SigningKeyView } from "@/lib/types";
import { awsJson } from "./aws";
import {
  defaultCloudFrontPrivateKeyParam,
  defaultCloudFrontPublicKeyParam,
  ownershipOf,
  readConfig,
} from "./environments";
import { lastMeaningfulLines, run } from "./exec";
import { repoRoot } from "./repo";

/**
 * The CloudFront URL-signing key pair, and whether this environment has one.
 *
 * ## Two halves, two places, both SSM
 *
 * Every video plays through a signed URL — the distribution's behaviours are
 * gated by a key group, so an unsigned request is a 403. That needs a key pair:
 *
 * - the **public** half is read by `PlayMediaStack` at deploy time, which creates
 *   a `AWS::CloudFront::PublicKey` from the parameter's *value*. A stage that
 *   creates its own distribution therefore cannot deploy until it is there;
 * - the **private** half is read by the handlers at request time, by parameter
 *   *name*, which is what keeps a 1.7 KB credential out of a hundred Lambdas'
 *   environments — and out of this repository, which is why neither half is in a
 *   config file or in `.env`.
 *
 * The names come from the config (`cloudFrontPrivateKeyParam`,
 * `cloudFrontPublicKeyParam`), and on every stage here they are the same two
 * shared parameters: the pair is product configuration, like the Google client
 * id, rather than per-environment state.
 *
 * ## Reading is a read, writing is a script
 *
 * A check has to be cheap, so the state is two parameter names in one call — and
 * no `--with-decryption`, so no part of the private key ever reaches this
 * process. Creating one is `infra/scripts/ensure-cloudfront-key.mjs`, which is
 * where the key generation, the refusal to rotate, and the wording of both live
 * — and which somebody can also run from a terminal, where the same sentence is
 * the answer.
 *
 * A read that *fails* throws rather than reporting "not there": `GetParameters`
 * answers about missing names in the response, so a failure here is credentials
 * or a network, and reporting that as an absent key would launch a script that
 * generates a second pair against an account nobody can reach.
 */

export interface SigningKeyParams {
  privateParam: string;
  publicParam: string;
  /** Where the two names came from: this environment's config, or the defaults. */
  source: "config" | "default";
  /**
   * Whether these are *this* environment's own parameters.
   *
   * False for a config that names the shared `/play/cloudfront/*` pair — which
   * is `dev` (importing the distribution that pair gates) and any stage seeded
   * before the pair became per-environment. It is reported rather than
   * corrected: the parameter a config names is the key its distribution was
   * created against, and quietly pointing it somewhere else would invalidate
   * every signed URL that distribution hands out.
   */
  own: boolean;
}

export function signingKeyParams(stage: string): SigningKeyParams {
  const config = readConfig(stage);
  const named = Boolean(config?.cloudFrontPrivateKeyParam || config?.cloudFrontPublicKeyParam);
  const privateParam =
    config?.cloudFrontPrivateKeyParam ?? defaultCloudFrontPrivateKeyParam(stage);
  const publicParam =
    config?.cloudFrontPublicKeyParam ?? defaultCloudFrontPublicKeyParam(stage);
  return {
    privateParam,
    publicParam,
    source: named ? "config" : "default",
    own:
      privateParam === defaultCloudFrontPrivateKeyParam(stage) &&
      publicParam === defaultCloudFrontPublicKeyParam(stage),
  };
}

/** Whether both halves are in SSM. One call, and no secret is ever read. */
export async function signingKeyState(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<SigningKeyView> {
  const { privateParam, publicParam, source, own } = signingKeyParams(stage);

  // `Parameters[].Name` projects to a list of *strings*, not of objects — the
  // query is what decides the shape, and this is that shape.
  const answer = await awsJson<{
    Parameters?: string[];
    InvalidParameters?: string[];
  }>(
    [
      "ssm",
      "get-parameters",
      "--names",
      privateParam,
      publicParam,
      // Only the names, so a SecureString's value never crosses into this
      // process — `--with-decryption` is not passed, and nothing here wants it.
      "--query",
      "{Parameters: Parameters[].Name, InvalidParameters: InvalidParameters}",
    ],
    ctx,
  );

  const found = new Set(answer?.Parameters ?? []);
  const privateExists = found.has(privateParam);
  const publicExists = found.has(publicParam);

  // A stage that imports its distribution never reads the public parameter: the
  // public side of its pair is the key group that distribution already has, and
  // `existing.cloudFrontPublicKeyId` is what names it. So the question "can this
  // environment sign a URL" is the private half for an imported stage and both
  // halves for one that creates its own.
  const config = readConfig(stage);
  const importedMedia = config !== null && ownershipOf(config).media === false;

  return {
    privateParam,
    publicParam,
    source,
    own,
    privateExists,
    publicExists,
    importedMedia,
    ready: privateExists && (importedMedia || publicExists),
  };
}

export interface EnsureSigningKeyResult {
  key: SigningKeyView;
  /** What happened, in one sentence — a no-op is a result worth reporting. */
  note: string;
  /** The script's own output, for a transcript. */
  lines: string[];
}

/**
 * Puts a key pair in SSM if there is not one, and says what it found.
 *
 * **Idempotent, and it never rotates.** A key that exists is left exactly as it
 * is: CloudFront signs with the public key a distribution was created against,
 * so replacing the pair would invalidate every URL already handed out — that is
 * a deploy of a new public key, not a script. When both halves are there this
 * returns without spawning anything, which is what makes it safe to call on
 * every save.
 *
 * A stage that **imports** its media is refused rather than served: its
 * distribution was built against a public key that already exists, and a fresh
 * pair would be a pair that distribution does not know about. If both halves are
 * missing there, the parameter name is wrong rather than the key absent.
 */
export async function ensureSigningKey(
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<EnsureSigningKeyResult> {
  const before = await signingKeyState(stage, ctx);
  if (before.ready) {
    return { key: before, note: "both halves were already in SSM — nothing was written", lines: [] };
  }

  if (before.importedMedia) {
    throw new Error(
      `${stage} imports its videos bucket and distribution, so the key it signs with is the one ` +
        `that distribution was created against — a generated pair would not match it, and every ` +
        `signed URL it hands out would stop working. ` +
        `${before.privateParam} is not in SSM: either it holds that key under another name, and ` +
        `cloudFrontPrivateKeyParam has to say which, or the pair has to be replaced, which is a ` +
        `deploy of a new CloudFront public key rather than a script.`,
    );
  }

  const result = await run(
    "node",
    [
      "infra/scripts/ensure-cloudfront-key.mjs",
      `--stage=${stage}`,
      `--private-param=${before.privateParam}`,
      `--public-param=${before.publicParam}`,
      ...(ctx.profile ? [`--profile=${ctx.profile}`] : []),
      ...(ctx.region ? [`--region=${ctx.region}`] : []),
    ],
    { cwd: repoRoot(), timeoutMs: 2 * 60_000 },
  );

  if (result.code !== 0) {
    const detail = lastMeaningfulLines(result.stderr || result.stdout, 6).join("\n");
    throw new Error(`The CloudFront signing key could not be created:\n${detail}`);
  }

  const key = await signingKeyState(stage, ctx);
  const note = before.privateExists
    ? `the public half was derived from ${before.privateParam}`
    : `generated a 2048-bit RSA pair at ${before.privateParam} and ${before.publicParam}`;

  return { key, note, lines: result.stdout.split("\n").filter((line) => line.trim()) };
}
