import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { getVideo, updateVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { deleteObjects, getObjectText, listKeysUnderPrefix, putObjectText } from '../../lib/s3';
import {
  TRANSLATION_LANGUAGES,
  getTranslationLanguage,
  toTranslateLanguageCode,
  translateVtt,
} from '../../lib/translate';
import type { SubtitleTranslation } from '../../types';

interface GenerateTranslationsBody {
  /** BCP-47 language codes to generate. Defaults to all supported languages. */
  languages?: string[];
}

/**
 * Translates the (edited) source subtitles into the requested languages using
 * AWS Translate, writing one WebVTT file per language and preserving cue timing.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await requireVideoAccess(videoId, userId, 'write');

  if (video.subtitleStatus !== 'READY' || !video.subtitleKey) {
    throw new HttpError(409, 'Source subtitles are not ready');
  }

  const body = (event.body ? JSON.parse(event.body) : {}) as GenerateTranslationsBody;
  const requested = body.languages?.length ? body.languages : TRANSLATION_LANGUAGES.map((l) => l.bcp47);

  const targets = requested
    .map((language) => getTranslationLanguage(language))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  if (targets.length === 0) {
    throw new HttpError(400, `No supported languages requested (supported: ${TRANSLATION_LANGUAGES.map((l) => l.bcp47).join(', ')})`);
  }

  const sourceContent = await getObjectText(video.subtitleKey);
  const sourceLanguage = toTranslateLanguageCode(video.subtitleLanguage);

  const translations: Record<string, SubtitleTranslation> = { ...(video.translations ?? {}) };

  for (const target of targets) {
    translations[target.bcp47] = {
      language: target.bcp47,
      label: target.label,
      status: 'GENERATING',
    };
    await updateVideo(videoId, { translations });

    try {
      const vtt = await translateVtt(sourceContent, sourceLanguage, target);

      const prefix = `subtitles/${videoId}/translations/${target.bcp47}/`;
      const stale = (await listKeysUnderPrefix(prefix)).filter((k) => k.endsWith('.vtt'));
      if (stale.length) await deleteObjects(stale);

      const key = `subtitles/${videoId}/translations/${target.bcp47}/subtitles-${Date.now()}.vtt`;
      await putObjectText(key, vtt, 'text/vtt');

      translations[target.bcp47] = {
        language: target.bcp47,
        label: target.label,
        status: 'READY',
        key,
      };
    } catch (err) {
      console.error(`Failed to translate to ${target.bcp47} for videoId=${videoId}`, err);
      translations[target.bcp47] = {
        language: target.bcp47,
        label: target.label,
        status: 'FAILED',
      };
    }

    await updateVideo(videoId, { translations });
  }

  const updated = await getVideo(videoId);
  return ok({ video: updated });
}

export const handler = handle(main);
