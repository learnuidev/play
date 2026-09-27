import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { buildContentFileUrls, listContentFiles } from '../../lib/content-files';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * Everything attached to a piece of content, each with a signed CloudFront URL.
 *
 * The whole content's attachments are listed rather than paged: a lesson's
 * material is a handful of files, and the URLs are signed under one policy
 * scoped to the content's prefix, so one signature serves them all.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  await requireContentAccess(contentId, userId, 'read');

  const files = await listContentFiles(contentId);
  const { urls, expiresAt } = await buildContentFileUrls(files);

  return ok({
    files: files.map((file) => ({ ...file, url: urls.get(file.fileId) })),
    expiresAt,
  });
}

export const handler = handle(main);
