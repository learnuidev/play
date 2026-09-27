import { buildSignedObjectUrl } from './cloudfront';
import { createPresignedUploadUrl, deleteObjects, listKeysUnderPrefix } from './s3';
import type { SpaceThumbnailInfo } from '../types';

/**
 * Space covers live under their own prefix in the videos bucket rather than a
 * separate one: the distribution, its origin access control, and the signing key
 * group already serve that bucket, so a cover is deliverable the moment it
 * lands. The prefix is what keeps the two kinds of image apart.
 */
const SPACE_PREFIX = 'spaces';

/** S3 key prefix for every object belonging to a space: spaces/{spaceId}/ */
export function spaceThumbnailPrefix(spaceId: string): string {
  return `${SPACE_PREFIX}/${spaceId}/`;
}

/** Whether a key is a cover belonging to this space. */
export function isSpaceThumbnailKey(spaceId: string, key: string | undefined): boolean {
  return !!key && key.startsWith(spaceThumbnailPrefix(spaceId));
}

export interface SpaceThumbnailUpload {
  key: string;
  url: string;
}

/**
 * Creates a presigned PUT URL for a space cover. The key is timestamped per
 * call, so replacing a cover writes a new object and CloudFront never has to be
 * invalidated.
 */
export async function createSpaceThumbnailUploadUrl(params: {
  spaceId: string;
  contentType: string;
  size?: number;
}): Promise<SpaceThumbnailUpload> {
  const extension = params.contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const key = `${spaceThumbnailPrefix(params.spaceId)}cover-${Date.now()}.${extension}`;
  const url = await createPresignedUploadUrl({
    key,
    contentType: params.contentType,
    ...(params.size !== undefined ? { size: params.size } : {}),
  });
  return { key, url };
}

/** Removes every previously uploaded cover for a space. */
export async function deleteSpaceThumbnails(spaceId: string): Promise<void> {
  const keys = await listKeysUnderPrefix(spaceThumbnailPrefix(spaceId));
  if (keys.length) await deleteObjects(keys);
}

/** Builds a signed CloudFront URL for a space's cover, scoped to its prefix. */
export async function buildSpaceThumbnailUrl(space: {
  spaceId: string;
  thumbnailKey: string;
}): Promise<SpaceThumbnailInfo> {
  const { url, ...rest } = await buildSignedObjectUrl(
    space.thumbnailKey,
    spaceThumbnailPrefix(space.spaceId),
  );
  return { spaceId: space.spaceId, thumbnailUrl: url, ...rest };
}
