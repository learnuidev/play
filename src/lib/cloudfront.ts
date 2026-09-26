import { createSign } from "node:crypto";
import type { AudioInfo, StreamInfo, SubtitleInfo, ThumbnailInfo } from "../types";
import { env } from "./config";

// wip

/** CloudFront uses URL-safe base64 (no padding) for Policy/Signature values. */
function toUrlSafeBase64(input: string | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "~")
    .replace(/=/g, "_");
}

/** RSA-SHA1 signature over the policy JSON, as CloudFront expects. */
function signPolicy(policyJson: string, privateKeyPem: string): Buffer {
  const signer = createSign("RSA-SHA1");
  signer.update(policyJson);
  return signer.sign(privateKeyPem);
}

interface SignedUrl {
  url: string;
  baseUrl: string;
  signedQuery: string;
  expiresAt: number;
}

/** The distribution's origin, with no key path — for building sibling URLs. */
export function cloudfrontOrigin(): string {
  return `https://${env.cloudfrontDomain}`;
}

/**
 * Signs a single object URL using a path-scoped custom policy that covers
 * every file under `wildcardPrefix`. Because the policy is path-scoped
 * (rather than signed against a single URL), the SAME query string is valid
 * for every file under that prefix — so the frontend can append it to each
 * segment/subtitle request.
 */
export function buildSignedObjectUrl(objectKey: string, wildcardPrefix: string): SignedUrl {
  const baseUrl = `https://${env.cloudfrontDomain}/${objectKey}`;
  const expiresAt = Math.floor(Date.now() / 1000) + env.streamTtlSeconds;
  const resource = `https://${env.cloudfrontDomain}/${wildcardPrefix}*`;

  const policyJson = JSON.stringify({
    Statement: [
      {
        Resource: resource,
        Condition: {
          DateLessThan: { "AWS:EpochTime": expiresAt },
        },
      },
    ],
  });

  const policy = toUrlSafeBase64(policyJson);
  const signature = toUrlSafeBase64(
    signPolicy(policyJson, env.cloudfrontPrivateKey),
  );
  const signedQuery = `Policy=${policy}&Signature=${signature}&Key-Pair-Id=${env.cloudfrontKeyPairId}`;

  return {
    url: `${baseUrl}?${signedQuery}`,
    baseUrl,
    signedQuery,
    expiresAt,
  };
}

/**
 * Builds a CloudFront signed URL for the HLS master playlist, scoped to
 * `processed/{videoId}/hls/*`.
 */
export function buildSignedStreamUrl(manifestKey: string): StreamInfo {
  const pathPrefix = manifestKey.split("/").slice(0, 3).join("/"); // processed/{videoId}/hls
  const { url, ...rest } = buildSignedObjectUrl(manifestKey, `${pathPrefix}/`);
  return { manifestUrl: url, ...rest };
}

/**
 * Builds a CloudFront signed URL for the extracted audio track, scoped to
 * `processed/{videoId}/audio/*`.
 */
export function buildSignedAudioUrl(audioKey: string): AudioInfo {
  const pathPrefix = audioKey.split("/").slice(0, 3).join("/"); // processed/{videoId}/audio
  const { url, ...rest } = buildSignedObjectUrl(audioKey, `${pathPrefix}/`);
  return { videoId: audioKey.split("/")[1] ?? "", audioUrl: url, ...rest };
}

/**
 * Builds a CloudFront signed URL for a WebVTT subtitle file, scoped to
 * `subtitles/{videoId}/*`.
 */
export function buildSignedSubtitleUrl(subtitleKey: string): SubtitleInfo {
  const pathPrefix = subtitleKey.split("/").slice(0, 2).join("/"); // subtitles/{videoId}
  const { url, ...rest } = buildSignedObjectUrl(subtitleKey, `${pathPrefix}/`);
  return { videoId: subtitleKey.split("/")[1] ?? "", subtitleUrl: url, ...rest };
}

/**
 * Builds a CloudFront signed URL for a thumbnail image, scoped to
 * `thumbnails/{videoId}/*`.
 */
export function buildSignedThumbnailUrl(thumbnailKey: string): ThumbnailInfo {
  const pathPrefix = thumbnailKey.split("/").slice(0, 2).join("/"); // thumbnails/{videoId}
  const { url, ...rest } = buildSignedObjectUrl(thumbnailKey, `${pathPrefix}/`);
  return { videoId: thumbnailKey.split("/")[1] ?? "", thumbnailUrl: url, ...rest };
}
