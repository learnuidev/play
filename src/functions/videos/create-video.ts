import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { requireOwnerId } from '../../lib/auth';
import { putVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { createPresignedUploadUrl } from '../../lib/s3';
import type { Video } from '../../types';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'video';
}

interface CreateVideoBody {
  title?: string;
  description?: string;
  fileName?: string;
  contentType?: string;
  size?: number;
}

async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);

  const body = (event.body ? JSON.parse(event.body) : {}) as CreateVideoBody;
  const title = (body.title ?? '').trim();
  const fileName = sanitizeFileName(body.fileName ?? '');
  const contentType = body.contentType ?? 'application/octet-stream';
  const size = typeof body.size === 'number' ? body.size : undefined;
  const description = (body.description ?? '').trim();

  if (!title) throw new HttpError(400, 'title is required');
  if (title.length > MAX_TITLE_LENGTH) throw new HttpError(400, `title must be <= ${MAX_TITLE_LENGTH} characters`);
  if (!fileName) throw new HttpError(400, 'fileName is required');
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new HttpError(400, `description must be <= ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  const videoId = randomUUID();
  const now = Date.now();
  const s3Key = `uploads/${videoId}/${fileName}`;

  const video: Video = {
    videoId,
    ownerId,
    title,
    description,
    status: 'UPLOADING',
    fileName,
    contentType,
    size: size ?? 0,
    s3Key,
    createdAt: now,
    updatedAt: now,
  };

  await putVideo(video);

  const uploadUrl = await createPresignedUploadUrl({
    key: s3Key,
    contentType,
    ...(size !== undefined ? { size } : {}),
  });

  return ok(
    {
      video,
      upload: {
        url: uploadUrl,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
      },
    },
    201,
  );
}

export const handler = handle(main);
