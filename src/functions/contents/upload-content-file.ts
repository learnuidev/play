import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addContentCounters } from '../../lib/contents';
import { createContentFileUpload } from '../../lib/content-files';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseContentType } from '../../lib/validation';

/** Largest attachment this API will reserve. S3 PUTs of one body stop at 5 GB. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

const MAX_NAME_LENGTH = 200;

interface UploadContentFileBody {
  name?: unknown;
  contentType?: unknown;
  size?: unknown;
}

/**
 * Attaches a file to a piece of content. Returns a presigned S3 PUT URL the
 * client uploads to directly, so the bytes never pass through the API.
 *
 * The file's row is written here, before the upload: there is no pipeline
 * watching this bucket for attachments, so the record cannot be confirmed
 * afterwards the way a video's is. The count on the content moves in the same
 * request, which is what the content page shows.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'write');

  const body = jsonBody<UploadContentFileBody>(event);
  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw new HttpError(400, 'name is required');
  }

  const name = body.name.trim().slice(0, MAX_NAME_LENGTH);
  const contentType = parseContentType(body.contentType);

  if (body.size !== undefined && typeof body.size !== 'number') {
    throw new HttpError(400, 'size must be a number of bytes');
  }
  const size = typeof body.size === 'number' ? body.size : undefined;
  if (size !== undefined && size > MAX_FILE_BYTES) {
    throw new HttpError(413, `File must be <= ${MAX_FILE_BYTES} bytes`);
  }

  const { file, upload } = await createContentFileUpload({
    contentId,
    fileId: ulid(),
    name,
    contentType,
    ...(size !== undefined ? { size } : {}),
    uploadedBy: userId,
  });

  await addContentCounters(contentId, { fileCount: 1 });

  return ok({ file, upload }, 201);
}

export const handler = handle(main);
