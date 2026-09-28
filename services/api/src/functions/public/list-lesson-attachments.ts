import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCallerContentAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { requireScope } from '../../lib/oauth-scopes';
import { buildContentFileUrls, listContentFiles } from '../../lib/content-files';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * What a lesson carries besides its video: the worksheets, the slides, the
 * source files.
 *
 * `lessons:read`, where the video behind the same lesson needs
 * `lessons:stream`: a worksheet is a file somebody asked for by name, and the
 * whole course's media is not.
 *
 * Everything attached to the lesson, each with a signed URL — signed as one
 * policy scoped to the lesson's own prefix, so a signature is produced once and
 * serves every file rather than one signature per attachment. That is also why
 * the whole list comes back at once: a lesson's material is a handful of files,
 * and paging it would cost more than it saved.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = requireApiCaller(event);
  requireScope(caller, 'lessons:read');

  const content = await requireCallerContentAccess(pathParam(event, 'contentId'), caller);

  const files = await listContentFiles(content.contentId);
  const { urls, expiresAt } = await buildContentFileUrls(files);

  return ok({
    attachments: files.map((file) => ({
      fileId: file.fileId,
      name: file.name,
      contentType: file.contentType,
      ...(file.size !== undefined ? { size: file.size } : {}),
      url: urls.get(file.fileId),
      createdAt: file.createdAt,
    })),
    expiresAt,
  });
}

export const handler = handle(main);
