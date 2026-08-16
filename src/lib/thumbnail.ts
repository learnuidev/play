import { buildSignedThumbnailUrl } from './cloudfront';
import { env } from './config';
import { startThumbnailJob } from './mediaconvert';
import {
  createPresignedUploadUrl,
  deleteObjects,
  deletePrefix,
  listKeysUnderPrefix,
} from './s3';
import type { ThumbnailInfo } from '../types';

const THUMBNAIL_PREFIX = 'thumbnails';

/** S3 key prefix for every object belonging to a video's thumbnails. */
export function thumbnailPrefix(videoId: string): string {
  return `${THUMBNAIL_PREFIX}/${videoId}/`;
}

/** MediaConvert FILE_GROUP destination (S3 URI) for a video's poster frames. */
export function thumbnailDestination(videoId: string): string {
  return `s3://${env.bucket}/${THUMBNAIL_PREFIX}/${videoId}/thumb`;
}

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;

/**
 * Finds the best poster frame produced by MediaConvert. Frame captures are
 * written as `thumb.NNNNNNN.jpg` (one per 5s). The middle frame is preferred
 * so the first (often black/blank) frame is skipped when possible.
 */
export async function findThumbnailKey(videoId: string): Promise<string | undefined> {
  const keys = (await listKeysUnderPrefix(thumbnailPrefix(videoId))).filter((k) =>
    IMAGE_EXTENSION.test(k),
  );
  if (keys.length === 0) return undefined;
  keys.sort();
  return keys[Math.floor((keys.length - 1) / 2)];
}

/** Builds a signed CloudFront URL for the given thumbnail key. */
export function buildThumbnailSignedUrl(thumbnailKey: string): ThumbnailInfo {
  return buildSignedThumbnailUrl(thumbnailKey);
}

/**
 * Regenerates a video's thumbnail: clears any prior poster frames and submits
 * a standalone MediaConvert frame-capture job. Completion is handled by the
 * MediaConvert state-change listener.
 */
export async function startThumbnailGeneration(videoId: string, inputUrl: string): Promise<void> {
  await deletePrefix(thumbnailPrefix(videoId));
  await startThumbnailJob({
    videoId,
    inputUrl,
    outputBase: thumbnailDestination(videoId),
  });
}

/** Deletes every thumbnail object for a video. */
export async function deleteThumbnails(videoId: string): Promise<void> {
  await deletePrefix(thumbnailPrefix(videoId));
}

export interface CustomThumbnailUpload {
  key: string;
  url: string;
}

/**
 * Creates a presigned PUT URL for a custom thumbnail image. The key is
 * deterministic per call (timestamped) so CloudFront serves it without
 * cache invalidation.
 */
export async function createCustomThumbnailUploadUrl(params: {
  videoId: string;
  contentType: string;
  size?: number;
}): Promise<CustomThumbnailUpload> {
  const extension = params.contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const key = `${THUMBNAIL_PREFIX}/${params.videoId}/custom-${Date.now()}.${extension}`;
  const url = await createPresignedUploadUrl({
    key,
    contentType: params.contentType,
    ...(params.size !== undefined ? { size: params.size } : {}),
  });
  return { key, url };
}

/** Removes previously uploaded custom thumbnails, keeping auto frames. */
export async function deleteCustomThumbnails(videoId: string): Promise<void> {
  const keys = (await listKeysUnderPrefix(thumbnailPrefix(videoId))).filter((k) =>
    k.includes('/custom-'),
  );
  if (keys.length) await deleteObjects(keys);
}
