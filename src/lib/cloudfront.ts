import * as cfsign from 'aws-cloudfront-sign';
import type { StreamInfo } from '../types';
import { env } from './config';

/**
 * Builds a CloudFront signed URL for the HLS master playlist using a
 * path-based custom policy that covers every file under
 * `https://{domain}/{manifestKey up to processed/{id}}/*`.
 *
 * Because the policy is path-scoped (rather than signed against a single
 * URL), the SAME `Policy`/`Signature`/`Key-Pair-Id` query string is valid
 * for every HLS segment under the video's processed prefix. The frontend
 * appends this query string to each segment request via hls.js `xhrSetup`.
 */
export function buildSignedStreamUrl(manifestKey: string): StreamInfo {
  const pathPrefix = manifestKey.split('/').slice(0, 3).join('/'); // processed/{videoId}
  const baseUrl = `https://${env.cloudfrontDomain}/${manifestKey}`;
  const expiresAt = Math.floor(Date.now() / 1000) + env.streamTtlSeconds;
  const resource = `https://${env.cloudfrontDomain}/${pathPrefix}/*`;

  const policy = {
    Statement: [
      {
        Resource: resource,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': expiresAt },
        },
      },
    ],
  };

  const url = cfsign.getSignedUrl(baseUrl, {
    keypairId: env.cloudfrontKeyPairId,
    privateKeyString: env.cloudfrontPrivateKey,
    policy: JSON.stringify(policy),
  });

  return {
    manifestUrl: url,
    baseUrl,
    signedQuery: url.split('?')[1] ?? '',
    expiresAt,
  };
}
