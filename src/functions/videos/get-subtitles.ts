import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireOwnerId } from '../../lib/auth';
import { buildSignedSubtitleUrl } from '../../lib/cloudfront';
import { getVideo } from '../../lib/dynamodb';
import { HttpError, handle, ok } from '../../lib/http';
import { getObjectText } from '../../lib/s3';
import type { SubtitleLanguageContent, SubtitleTrackInfo } from '../../types';

/**
 * Returns the raw source VTT content (for the editor) plus signed CloudFront
 * URLs for every available subtitle track — the source language and any
 * generated translations.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const ownerId = requireOwnerId(event);
  const videoId = event.pathParameters?.videoId;

  if (!videoId) throw new HttpError(400, 'videoId path parameter is required');

  const video = await getVideo(videoId);
  if (!video) throw new HttpError(404, 'Video not found');
  if (video.ownerId !== ownerId) throw new HttpError(403, 'Forbidden');

  if (video.subtitleStatus !== 'READY' || !video.subtitleKey) {
    throw new HttpError(409, `Subtitles are not ready (status: ${video.subtitleStatus ?? 'NONE'})`);
  }

  const content = await getObjectText(video.subtitleKey);
  const sourceLanguage = video.subtitleLanguage ?? 'en-US';
  const sourceLabel = sourceLanguage.toLowerCase().startsWith('en') ? 'English' : sourceLanguage;

  const tracks: SubtitleTrackInfo[] = [
    {
      ...buildSignedSubtitleUrl(video.subtitleKey),
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
      ...buildSignedSubtitleUrl(translation.key),
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
  });
}

export const handler = handle(main);
