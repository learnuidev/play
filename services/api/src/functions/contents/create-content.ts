import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireSectionAccess } from '../../lib/access';
import { requireUser } from '../../lib/auth';
import { nextContentPosition, putContent } from '../../lib/contents';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseNotes, parsePosition, parseTitle } from '../../lib/validation';
import { CONTENT_TYPES, type Content, type ContentType } from '../../types';

const MIN_TITLE_LENGTH = 2;
const MAX_TITLE_LENGTH = 120;

interface CreateContentBody {
  title?: unknown;
  type?: unknown;
  videoId?: unknown;
  notes?: unknown;
  position?: unknown;
}

/**
 * Checks that a video may be attached to content in this organization.
 *
 * A course may only play what its own organization owns: a video id from
 * somewhere else would either leak another organization's library or produce a
 * link that plays for the author and nobody else.
 */
async function requireOwnVideo(videoId: string, organizationId: string): Promise<void> {
  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.organizationId !== organizationId) {
    throw new HttpError(400, 'videoId must be a video from this organization');
  }
}

/**
 * Files a piece of content under a section.
 *
 * The video is optional so a course can be outlined — titles and notes — before
 * the footage exists, and a `VIDEO` content without one renders as a lesson
 * waiting for its video rather than as a broken player.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const sectionId = pathParam(event, 'sectionId');

  const section = await requireSectionAccess(sectionId, user.userId, 'write');
  const body = jsonBody<CreateContentBody>(event);

  const title = parseTitle(body.title, { min: MIN_TITLE_LENGTH, max: MAX_TITLE_LENGTH });

  const type = (body.type ?? 'VIDEO') as ContentType;
  if (!CONTENT_TYPES.includes(type)) {
    throw new HttpError(400, `type must be one of ${CONTENT_TYPES.join(', ')}`);
  }

  const videoId = typeof body.videoId === 'string' && body.videoId.trim() ? body.videoId.trim() : undefined;
  if (videoId) await requireOwnVideo(videoId, section.organizationId);

  const notes = body.notes === undefined || body.notes === null ? undefined : parseNotes(body.notes);
  const position =
    body.position === undefined ? await nextContentPosition(sectionId) : parsePosition(body.position);

  const now = Date.now();
  const content: Content = {
    contentId: ulid(),
    sectionId,
    spaceId: section.spaceId,
    organizationId: section.organizationId,
    title,
    type,
    ...(videoId ? { videoId } : {}),
    ...(notes ? { notes } : {}),
    position,
    // Counters start at zero rather than being absent, so every read of a
    // content row can show them without a missing-attribute check.
    fileCount: 0,
    favouriteCount: 0,
    commentCount: 0,
    createdBy: user.userId,
    createdAt: now,
    updatedAt: now,
  };

  await putContent(content);

  return ok({ content }, 201);
}

export const handler = handle(main);
