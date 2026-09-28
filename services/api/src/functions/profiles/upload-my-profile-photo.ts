import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireUser } from '../../lib/auth';
import { HttpError, handle, jsonBody, ok } from '../../lib/http';
import { createProfilePhotoUploadUrl, deleteProfilePhotos } from '../../lib/profile-photo';
import { ensureProfile, setProfilePhoto, toProfile } from '../../lib/profiles';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

interface UploadProfilePhotoBody {
  contentType?: string;
  size?: number;
}

/**
 * Sets or replaces the caller's profile photo.
 *
 * The same shape as a course cover, and for the same reasons: the bytes go
 * straight from the browser to S3 through a presigned PUT, only the key passes
 * through this API, and the row points at the new object before the upload has
 * finished — so a page reloaded mid-upload shows the new photo rather than
 * nothing.
 *
 * The previous photo is deleted first. Photos are timestamped, so leaving the old
 * one behind would accumulate invisible objects in the bucket, and a person's
 * face is the one thing in there worth actually removing when they replace it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);

  // A photo is an edit to a profile, and an edit needs a row to edit: an account
  // that has never been read is named here, exactly as the profile screen does.
  await ensureProfile(user);

  const body = jsonBody<UploadProfilePhotoBody>(event);
  const contentType = body.contentType ?? 'image/jpeg';
  const size = typeof body.size === 'number' ? body.size : undefined;

  if (!contentType.startsWith('image/')) {
    throw new HttpError(400, 'contentType must be an image type (e.g. image/jpeg)');
  }
  if (size !== undefined && size > MAX_PHOTO_BYTES) {
    throw new HttpError(413, `A profile photo must be <= ${MAX_PHOTO_BYTES} bytes`);
  }

  await deleteProfilePhotos(user.userId);
  const { key, url } = await createProfilePhotoUploadUrl({
    userId: user.userId,
    contentType,
    ...(size !== undefined ? { size } : {}),
  });

  await setProfilePhoto(user.userId, key);

  const updated = await ensureProfile(user);
  return ok({
    profile: await toProfile(updated),
    upload: {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    },
  });
}

export const handler = handle(main);
