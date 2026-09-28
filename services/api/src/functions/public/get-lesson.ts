import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCallerContentAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { requireScope } from '../../lib/oauth-scopes';
import { buildThumbnailSignedUrl } from '../../lib/thumbnail';
import { getVideo } from '../../lib/dynamodb';
import { handle, ok, pathParam } from '../../lib/http';

/**
 * One lesson, to a credential that may read it.
 *
 * What a lesson *is*: its title, the notes beside the video as the author wrote
 * them, and enough to draw the page before the media arrives — the poster, and
 * which video it plays. The video itself, its subtitles and its attachments each
 * have an endpoint of their own, because each is fetched at a different moment
 * and signed with its own expiry.
 *
 * The notes travel as the document the author wrote — a ProseMirror tree, the
 * same one the classroom renders — rather than as HTML. This API does not
 * sanitize markup for a caller, and a document that a caller renders with the
 * editor of their choice is not a string anybody has to trust.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = requireApiCaller(event);
  requireScope(caller, 'lessons:read');

  const content = await requireCallerContentAccess(pathParam(event, 'contentId'), caller);

  // The poster lives on the video rather than the lesson, so it costs one more
  // read — and it is worth it: a lesson page that renders a blank frame until
  // the manifest loads is a lesson page that looks broken for a second.
  const video = content.videoId ? await getVideo(content.videoId) : undefined;
  const thumbnailUrl = video?.thumbnailKey
    ? (await buildThumbnailSignedUrl(video.thumbnailKey)).thumbnailUrl
    : undefined;

  return ok({
    lesson: {
      contentId: content.contentId,
      spaceId: content.spaceId,
      sectionId: content.sectionId,
      title: content.title,
      ...(content.notes ? { notes: content.notes } : {}),
      ...(content.videoId ? { videoId: content.videoId } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      fileCount: content.fileCount,
      position: content.position,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
    },
  });
}

export const handler = handle(main);
