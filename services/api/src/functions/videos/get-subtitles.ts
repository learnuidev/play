import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireVideoAccess } from '../../lib/access';
import { requireUserId } from '../../lib/auth';
import { buildSignedSubtitleUrl } from '../../lib/cloudfront';
import { HttpError, handle, ok } from '../../lib/http';
import { getObjectText } from '../../lib/s3';
import { MAX_TRANSCRIPT_WORDS, readTranscriptWords } from '../../lib/transcript-words';
import type { SubtitleLanguageContent, SubtitleTrackInfo } from '../../types';

/**
 * Returns the raw source VTT content (for the editor) plus signed CloudFront
 * URLs for every available subtitle track — the source language and any
 * generated translations. Word timings ride along with it when the video has
 * them, because a transcript that animates word by word needs more than a cue's
 * boundaries can say.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = requireUserId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await requireVideoAccess(videoId, userId, 'read');

  if (video.subtitleStatus !== 'READY' || !video.subtitleKey) {
    throw new HttpError(409, `Subtitles are not ready (status: ${video.subtitleStatus ?? 'NONE'})`);
  }

  const content = await getObjectText(video.subtitleKey);
  const sourceLanguage = video.subtitleLanguage ?? 'en-US';
  const sourceLabel = sourceLanguage.toLowerCase().startsWith('en') ? 'English' : sourceLanguage;

  const words = await readTranscriptWords(videoId);

  const tracks: SubtitleTrackInfo[] = [
    {
      ...(await buildSignedSubtitleUrl(video.subtitleKey)),
      language: sourceLanguage,
      label: sourceLabel,
      isSource: true,
    },
  ];

  const languages: SubtitleLanguageContent[] = [
    { language: sourceLanguage, label: sourceLabel, isSource: true, content },
  ];

  for (const [language, translation] of Object.entries(video.translations ?? {})) {
    if (translation.status !== 'READY' || !translation.key) continue;
    tracks.push({
      ...(await buildSignedSubtitleUrl(translation.key)),
      language,
      label: translation.label,
      isSource: false,
    });
    languages.push({
      language,
      label: translation.label,
      isSource: false,
      content: await getObjectText(translation.key),
    });
  }

  return ok({
    videoId,
    content,
    sourceLanguage,
    tracks,
    languages,
    // Capped: a transcript long enough to exceed this is one whose reader will
    // scroll rather than follow, and the frontend falls back to interpolating
    // whatever is missing.
    ...(words ? { words: words.slice(0, MAX_TRANSCRIPT_WORDS) } : {}),
  });
}

export const handler = handle(main);
