import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireContentAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getContent, updateContent, type UpdateContentPatch } from '../../lib/contents';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseNotes, parsePosition, parseTitle } from '../../lib/validation';
import { CONTENT_TYPES, type ContentType } from '../../types';

const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 120;

interface UpdateContentBody {
  title?: unknown;
  type?: unknown;
  /** A video id to attach, or `null` to detach. */
  videoId?: unknown;
  /** A ProseMirror document, or `null` to clear the notes. */
  notes?: unknown;
  position?: unknown;
}

/**
 * Changes a piece of content: its title, the video it plays, its notes, or where
 * it sits in its section.
 *
 * `videoId: null` and `notes: null` mean "unlink this" — the difference between
 * a field a request did not mention and a field it emptied.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const contentId = pathParam(event, 'contentId');

  const existing = await requireContentAccess(contentId, userId, 'write');
  const body = jsonBody<UpdateContentBody>(event);

  const patch: UpdateContentPatch = {};

  if (body.title !== undefined) {
    patch.title = parseTitle(body.title, { min: MIN_TITLE_LENGTH, max: MAX_TITLE_LENGTH });
  }

  if (body.type !== undefined) {
    const type = body.type as ContentType;
    if (!CONTENT_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of ${CONTENT_TYPES.join(', ')}`);
    }
    patch.type = type;
  }

  if (body.videoId !== undefined) {
    if (body.videoId === null || body.videoId === '') {
      patch.videoId = null;
    } else if (typeof body.videoId === 'string') {
      const video = await getVideo(body.videoId.trim());
      if (!video) throw new HttpError(404, 'Video not found');
      if (video.organizationId !== existing.organizationId) {
        throw new HttpError(400, 'videoId must be a video from this organization');
      }
      patch.videoId = video.videoId;
    } else {
      throw new HttpError(400, 'videoId must be a video id or null');
    }
  }

  if (body.notes !== undefined) {
    patch.notes = body.notes === null ? null : parseNotes(body.notes);
  }

  if (body.position !== undefined) {
    patch.position = parsePosition(body.position);
  }

  if (Object.keys(patch).length === 0) {
    return ok({ content: existing });
  }

  await updateContent(contentId, patch);

  return ok({ content: await getContent(contentId) });
}

export const handler = handle(main);
