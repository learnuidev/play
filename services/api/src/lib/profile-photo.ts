import { buildSignedObjectUrl } from './cloudfront';
import { createPresignedUploadUrl, deleteObjects, listKeysUnderPrefix } from './s3';

/**
 * Profile photos live in the videos bucket under a prefix of their own, exactly
 * as course covers do: the distribution, its origin access control and the
 * signing key group already serve that bucket, so a face is deliverable the
 * moment it lands, and the prefix is what keeps one kind of image from being
 * mistaken for another.
 *
 * One folder per person, which is what makes replacing a photo safe: the upload
 * is timestamped, so the old object can be swept without touching anybody else's.
 */
const PEOPLE_PREFIX = 'people';

/** S3 key prefix for every object belonging to a person: people/{userId}/ */
export function profilePhotoPrefix(userId: string): string {
  return `${PEOPLE_PREFIX}/${userId}/`;
}

export interface ProfilePhotoUpload {
  key: string;
  url: string;
}

/**
 * Creates a presigned PUT URL for a profile photo.
 *
 * Timestamped per call, so replacing a photo writes a new object — which is what
 * keeps CloudFront out of it: a URL that has already been handed to a browser
 * keeps showing the old face until it expires, and nothing has to be
 * invalidated for the new one to appear.
 */
export async function createProfilePhotoUploadUrl(params: {
  userId: string;
  contentType: string;
  size?: number;
}): Promise<ProfilePhotoUpload> {
  const extension = params.contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const key = `${profilePhotoPrefix(params.userId)}photo-${Date.now()}.${extension}`;
  const url = await createPresignedUploadUrl({
    key,
    contentType: params.contentType,
    ...(params.size !== undefined ? { size: params.size } : {}),
  });
  return { key, url };
}

/** Removes every previously uploaded photo for a person. */
export async function deleteProfilePhotos(userId: string): Promise<void> {
  const keys = await listKeysUnderPrefix(profilePhotoPrefix(userId));
  if (keys.length) await deleteObjects(keys);
}

/** A signed CloudFront URL for a profile photo, scoped to its own prefix. */
export async function buildProfilePhotoUrl(userId: string, photoKey: string): Promise<string> {
  const { url } = await buildSignedObjectUrl(photoKey, profilePhotoPrefix(userId));
  return url;
}
