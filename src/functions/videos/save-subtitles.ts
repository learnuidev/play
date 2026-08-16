import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { deleteObjects, deletePrefix, listKeysUnderPrefix, putObjectText } from '../../lib/s3';

const MAX_SUBTITLE_BYTES = 1024 * 1024; // 1 MB

interface SaveSubtitlesBody {
  content?: string;
}

/**
 * Overwrites the video's WebVTT subtitles with edited content. Writes to a
 * fresh key (so CloudFront serves the edit without cache invalidation) and
 * deletes the previous `.vtt` files.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');
  if (video.subtitleStatus !== 'READY' || !video.subtitleKey) {
    throw new HttpError(409, 'Subtitles are not ready to edit');
  }

  const body = (event.body ? JSON.parse(event.body) : {}) as SaveSubtitlesBody;
  const content = (body.content ?? '').trim();

  if (!content) throw new HttpError(400, 'content is required');
  if (!content.startsWith('WEBVTT')) {
    throw new HttpError(400, 'content must be a WebVTT document (start with WEBVTT)');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_SUBTITLE_BYTES) {
    throw new HttpError(413, 'Subtitles are too large');
  }

  // Remove the previous .vtt file(s) so only the fresh one remains.
  const prefix = `subtitles/${videoId}/source/`;
  const staleVtts = (await listKeysUnderPrefix(prefix)).filter((k) => k.endsWith('.vtt'));
  if (staleVtts.length) await deleteObjects(staleVtts);

  const key = `subtitles/${videoId}/source/subtitles-${Date.now()}.vtt`;
  await putObjectText(key, content, 'text/vtt');

  // Editing the source subtitle invalidates any previously generated
  // translations, so clear them (and their files) to avoid serving stale tracks.
  await deletePrefix(`subtitles/${videoId}/translations/`);
  await updateVideo(videoId, { subtitleKey: key, subtitleStatus: 'READY', translations: null });

  const updated = await getVideo(videoId);
  return ok({ video: updated });
}

export const handler = handle(main);
