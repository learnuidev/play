import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { deleteObjects, deletePrefix, listKeysUnderPrefix, putObjectText } from '../../lib/s3';

const MAX_SUBTITLE_BYTES = 1024 * 1024; // 1 MB

interface SaveSubtitlesBody {
  content?: string;
  /** BCP-47 language code of the track to edit. Omitted for the source track. */
  language?: string;
}

/**
 * Overwrites a WebVTT subtitle track with edited content. Editing the source
 * track writes to a fresh source key (so CloudFront serves the edit without
 * cache invalidation) and invalidates previously generated translations.
 * Editing a translation only rewrites that translation's track.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await requireVideoAccess(videoId, userId, 'write');
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

  const sourceLanguage = video.subtitleLanguage ?? 'en-US';
  const isTranslation = Boolean(body.language && body.language !== sourceLanguage);

  if (isTranslation) {
    const language = body.language as string;
    const existing = video.translations?.[language];
    if (!existing) {
      throw new HttpError(404, `Translation not found for language "${language}"`);
    }

    // Replace the previous .vtt file(s) for this language so only the fresh
    // one remains, then point the translation at the new key.
    const prefix = `subtitles/${videoId}/translations/${language}/`;
    const staleVtts = (await listKeysUnderPrefix(prefix)).filter((k) => k.endsWith('.vtt'));
    if (staleVtts.length) await deleteObjects(staleVtts);

    const key = `subtitles/${videoId}/translations/${language}/subtitles-${Date.now()}.vtt`;
    await putObjectText(key, content, 'text/vtt');

    const translations = { ...(video.translations ?? {}) };
    translations[language] = { ...existing, key, status: 'READY' };
    await updateVideo(videoId, { translations });

    const updated = await getVideo(videoId);
    return ok({ video: updated });
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
