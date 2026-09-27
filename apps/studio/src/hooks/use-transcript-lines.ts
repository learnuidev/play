'use client';

import { useMemo } from 'react';
import { parseVtt } from '@/lib/vtt';
import { buildTranscriptLines } from '@/lib/transcript';
import { useSubtitles } from '@/modules/subtitle/subtitle.queries';
import { useVideo } from '@/modules/video/video.queries';
import type { SubtitleTrack } from '@/components/video-player';

/**
 * A lesson's transcript, as lines with their words timed.
 *
 * Shared rather than fetched where it is drawn: the transcript tab reads it, the
 * loop picker selects whole lines out of it, and a loop in the list shows the
 * passage it covers. Three readers, one parse — and one query, which the video's
 * own record already needed anyway. The player is the fourth: the captions it
 * shows over the video are the same VTT files, so they come from here too rather
 * than from a second query for the same thing.
 *
 * `language` is the language the captions are in, when one has been chosen. The
 * transcript is the same words the video is saying, so a reader who put the
 * captions in French gets the French transcript rather than a translation of
 * their own reading matter — the two are one script and follow each other.
 */
export function useTranscriptLines(videoId?: string, language?: string | null) {
  const { data: videoRes } = useVideo(videoId ?? '', Boolean(videoId));
  const video = videoRes?.video;

  const ready = Boolean(videoId) && video?.subtitleStatus === 'READY';
  const { data: subtitles } = useSubtitles(videoId ?? '', ready);

  /**
   * The script being read: the chosen language if the video has it, and the
   * language it was transcribed in otherwise.
   *
   * The source is found by its flag rather than assumed to be first, and the
   * fallback covers a response that predates the per-language list, where the
   * source is the only script there is.
   */
  const script = useMemo(() => {
    const languages = subtitles?.languages ?? [];

    const chosen = language
      ? languages.find(
          (candidate) =>
            candidate.language.toLowerCase() === language.toLowerCase(),
        )
      : undefined;

    return (
      chosen ??
      languages.find((candidate) => candidate.isSource) ??
      (subtitles
        ? {
            language: subtitles.sourceLanguage,
            label: subtitles.sourceLanguage,
            isSource: true,
            content: subtitles.content,
          }
        : undefined)
    );
  }, [language, subtitles]);

  const lines = useMemo(() => {
    if (!script?.content) return [];
    // Word timings are the source's own: a translation is other words in the
    // same places, and pairing the two would animate the wrong ones. Without
    // them the fill spreads across each cue, which is honest about what it
    // knows.
    return buildTranscriptLines(
      parseVtt(script.content),
      script.isSource ? subtitles?.words : undefined,
    );
  }, [script, subtitles]);

  // In the order the API gives them in, which is the source language first and
  // the translations after it.
  const tracks = useMemo<SubtitleTrack[]>(
    () =>
      (subtitles?.tracks ?? []).map((track) => ({
        src: track.subtitleUrl,
        srcLang: track.language,
        label: track.label,
      })),
    [subtitles],
  );

  return { lines, video, tracks, hasTranscript: lines.length > 0 };
}