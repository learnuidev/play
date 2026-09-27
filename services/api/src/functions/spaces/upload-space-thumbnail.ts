import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireSpaceAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { HttpError, handle, ok } from '../../lib/http';
import { getSpace, setSpaceThumbnail } from '../../lib/spaces';
import { createSpaceThumbnailUploadUrl, deleteSpaceThumbnails } from '../../lib/space-thumbnail';

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5 MB

interface UploadSpaceThumbnailBody {
  contentType?: string;
  size?: number;
}

/**
 * Sets or replaces a space's cover image. Returns a presigned S3 PUT URL the
 * client uploads to directly; the key is committed to the space immediately, so
 * CloudFront serves the cover as soon as the upload lands.
 *
 * The previous cover is deleted first: covers are timestamped, so leaving the
 * old ones behind would accumulate invisible objects in the bucket.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const spaceId = event.pathParameters?.spaceId;

  if (!spaceId) throw new HttpError(400, 'spaceId path parameter is required');

  await requireSpaceAccess(spaceId, userId, 'write');

  const body = (event.body ? JSON.parse(event.body) : {}) as UploadSpaceThumbnailBody;
  const contentType = body.contentType ?? 'image/jpeg';
  const size = typeof body.size === 'number' ? body.size : undefined;

  if (!contentType.startsWith('image/')) {
    throw new HttpError(400, 'contentType must be an image type (e.g. image/jpeg)');
  }
  if (size !== undefined && size > MAX_THUMBNAIL_BYTES) {
    throw new HttpError(413, `Thumbnail must be <= ${MAX_THUMBNAIL_BYTES} bytes`);
  }

  await deleteSpaceThumbnails(spaceId);
  const { key, url } = await createSpaceThumbnailUploadUrl({
    spaceId,
    contentType,
    ...(size !== undefined ? { size } : {}),
  });

  await setSpaceThumbnail(spaceId, key);

  const updated = await getSpace(spaceId);
  return ok({
    space: updated,
    upload: {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    },
  });
}

export const handler = handle(main);
