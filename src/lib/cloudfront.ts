import { createSign } from 'node:crypto';
import type { StreamInfo } from '../types';
import { env } from './config';

/** CloudFront uses URL-safe base64 (no padding) for Policy/Signature values. */
function toUrlSafeBase64(input: string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '~')
    .replace(/=/g, '_');
}

/** RSA-SHA1 signature over the policy JSON, as CloudFront expects. */
function signPolicy(policyJson: string, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA1');
  signer.update(policyJson);
  return signer.sign(privateKeyPem, 'base64');
}

/**
 * Builds a CloudFront signed URL for the HLS master playlist using a
 * path-based custom policy that covers every file under
 * `https://{domain}/processed/{videoId}/hls/*`.
 *
 * Because the policy is path-scoped (rather than signed against a single
 * URL), the SAME `Policy`/`Signature`/`Key-Pair-Id` query string is valid
 * for every HLS segment under the video's processed prefix. The frontend
 * appends this query string to each segment request.
 */
export function buildSignedStreamUrl(manifestKey: string): StreamInfo {
  const pathPrefix = manifestKey.split('/').slice(0, 3).join('/'); // processed/{videoId}/hls
  const baseUrl = `https://${env.cloudfrontDomain}/${manifestKey}`;
  const expiresAt = Math.floor(Date.now() / 1000) + env.streamTtlSeconds;
  const resource = `https://${env.cloudfrontDomain}/${pathPrefix}/*`;

  const policyJson = JSON.stringify({
    Statement: [
      {
        Resource: resource,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': expiresAt },
        },
      },
    ],
  });

  const policy = toUrlSafeBase64(policyJson);
  const signature = toUrlSafeBase64(signPolicy(policyJson, env.cloudfrontPrivateKey));
  const signedQuery = `Policy=${policy}&Signature=${signature}&Key-Pair-Id=${env.cloudfrontKeyPairId}`;

  return {
    manifestUrl: `${baseUrl}?${signedQuery}`,
    baseUrl,
    signedQuery,
    expiresAt,
  };
}
