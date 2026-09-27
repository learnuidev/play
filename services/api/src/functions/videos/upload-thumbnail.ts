import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { createCustomThumbnailUploadUrl, deleteCustomThumbnails } from '../../lib/thumbnail';

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024; // 5 MB

interface UploadThumbnailBody {
  contentType?: string;
  size?: number;
}

/**
 * Replaces the current thumbnail with a custom image. Returns a presigned S3
 * PUT URL the client uploads directly to; the thumbnail key is committed to
 * the video immediately so CloudFront serves it as soon as it lands.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  await requireVideoAccess(videoId, userId, 'write');

  const body = (event.body ? JSON.parse(event.body) : {}) as UploadThumbnailBody;
  const contentType = body.contentType ?? 'image/jpeg';
  const size = typeof body.size === 'number' ? body.size : undefined;

  if (!contentType.startsWith('image/')) {
    throw new HttpError(400, 'contentType must be an image type (e.g. image/jpeg)');
  }
  if (size !== undefined && size > MAX_THUMBNAIL_BYTES) {
    throw new HttpError(413, `Thumbnail must be <= ${MAX_THUMBNAIL_BYTES} bytes`);
  }

  await deleteCustomThumbnails(videoId);
  const { key, url } = await createCustomThumbnailUploadUrl({
    videoId,
    contentType,
    ...(size !== undefined ? { size } : {}),
  });

  await updateVideo(videoId, { thumbnailKey: key });

  const updated = await getVideo(videoId);
  return ok({
    video: updated,
    upload: {
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    },
  });
}

export const handler = handle(main);
