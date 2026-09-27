import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { addContentCounters } from '../../lib/contents';
import {
  deleteContentFileItem,
  deleteContentFileObject,
  getContentFile,
} from '../../lib/content-files';
import { HttpError, handle, noContent, pathParam } from '../../lib/http';

/**
 * Detaches a file: the object goes from S3 and the row from the table, and the
 * content's count comes down with it.
 *
 * The row is looked up first so the object deleted is the one this content
 * actually owns, and the S3 object goes first: a row that outlives its object
 * is a broken link, an object that outlives its row is merely an invisible one.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const fileId = pathParam(event, 'fileId');

  await requireContentAccess(contentId, userId, 'write');

  const file = await getContentFile(contentId, fileId);
  if (!file) throw new HttpError(404, 'File not found');

  await deleteContentFileObject(file.key);
  await deleteContentFileItem(contentId, fileId);
  await addContentCounters(contentId, { fileCount: -1 });

  return noContent();
}

export const handler = handle(main);
