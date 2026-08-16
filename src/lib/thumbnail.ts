import { buildSignedThumbnailUrl } from './cloudfront';
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

/** Builds a signed CloudFront URL for the given thumbnail key. */
export function buildThumbnailSignedUrl(thumbnailKey: string): ThumbnailInfo {
  return buildSignedThumbnailUrl(thumbnailKey);
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

/** Removes previously uploaded custom thumbnails. */
export async function deleteCustomThumbnails(videoId: string): Promise<void> {
  const keys = (await listKeysUnderPrefix(thumbnailPrefix(videoId))).filter((k) =>
    k.includes('/custom-'),
  );
  if (keys.length) await deleteObjects(keys);
}
