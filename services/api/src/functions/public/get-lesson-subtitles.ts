import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireCallerContentAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { requireScope } from '../../lib/oauth-scopes';
import { buildSignedSubtitleUrl } from '../../lib/cloudfront';
import { getVideo } from '../../lib/dynamodb';
import { handle, ok, pathParam } from '../../lib/http';
import { MAX_TRANSCRIPT_WORDS, readTranscriptWords } from '../../lib/transcript-words';
import type { SubtitleStatus, SubtitleTrackInfo } from '../../types';

/**
 * A lesson's subtitles, and the transcript that goes with them.
 *
 * Every ready track — the language it was transcribed in, and any translation
 * the author generated — as a signed WebVTT URL. A caller hands those to
 * whatever player it uses.
 *
 * `words` is the other half of the same recording: each word with when it is
 * said, which is what lets a transcript highlight as it is read rather than
 * appearing a line at a time. It is capped, and a consumer that does not use it
 * can ignore it.
 *
 * Behind `lessons:stream` rather than `lessons:read`: a subtitle track is part
 * of playing the lesson, and it is signed for the same reason the manifest is.
 *
 * A lesson whose subtitles are not ready answers with the status and no tracks
 * rather than an error. "This video has no captions yet" is a state a page
 * renders — a caption button that is not there — where a 409 is a response the
 * caller has to catch to say the same thing.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = requireApiCaller(event);
  requireScope(caller, 'lessons:stream');

  const content = await requireCallerContentAccess(pathParam(event, 'contentId'), caller);

  if (!content.videoId) {
    return ok({ videoId: null, status: 'NONE' as SubtitleStatus, tracks: [], words: [] });
  }

  const video = await getVideo(content.videoId);
  if (!video) {
    return ok({ videoId: null, status: 'NONE' as SubtitleStatus, tracks: [], words: [] });
  }

  const status: SubtitleStatus = video.subtitleStatus ?? 'NONE';
  if (status !== 'READY' || !video.subtitleKey) {
    return ok({ videoId: video.videoId, status, tracks: [], words: [] });
  }

  const sourceLanguage = video.subtitleLanguage ?? 'en-US';
  const sourceLabel = sourceLanguage.toLowerCase().startsWith('en') ? 'English' : sourceLanguage;

  const tracks: SubtitleTrackInfo[] = [
    {
      ...(await buildSignedSubtitleUrl(video.subtitleKey)),
      language: sourceLanguage,
      label: sourceLabel,
      isSource: true,
    },
  ];

  for (const [language, translation] of Object.entries(video.translations ?? {})) {
    if (translation.status !== 'READY' || !translation.key) continue;
    tracks.push({
      ...(await buildSignedSubtitleUrl(translation.key)),
      language,
      label: translation.label,
      isSource: false,
    });
  }

  const words = await readTranscriptWords(video.videoId);

  return ok({
    videoId: video.videoId,
    status,
    sourceLanguage,
    tracks,
    // Capped for the same reason the classroom caps it: a transcript long enough
    // to exceed this is one somebody scrolls rather than follows, and a caller
    // that wants the rest has the WebVTT URL above.
    ...(words ? { words: words.slice(0, MAX_TRANSCRIPT_WORDS) } : {}),
  });
}

export const handler = handle(main);
