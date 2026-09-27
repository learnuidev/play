import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { buildContentFileUrl, getContentFile } from '../../lib/content-files';
import { HttpError, handle, ok, pathParam } from '../../lib/http';
import { env } from '../../lib/config';

/**
 * A signed CloudFront URL for one attachment.
 *
 * The signature is scoped to the content's prefix, the same one the listing
 * hands out, because a CloudFront policy covers a path rather than a URL — so
 * the link is one object's address under a signature that also covers its
 * siblings.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');
  const fileId = pathParam(event, 'fileId');

  await requireContentAccess(contentId, userId, 'read');

  const file = await getContentFile(contentId, fileId);
  if (!file) throw new HttpError(404, 'File not found');

  return ok({
    file,
    url: buildContentFileUrl(file),
    expiresAt: Math.floor(Date.now() / 1000) + env.streamTtlSeconds,
  });
}

export const handler = handle(main);
