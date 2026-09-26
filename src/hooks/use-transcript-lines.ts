'use client';

import { useMemo } from 'react';
import { parseVtt } from '@/lib/vtt';
import { buildTranscriptLines } from '@/lib/transcript';
import { useSubtitles } from '@/modules/subtitle/subtitle.queries';
import { useVideo } from '@/modules/video/video.queries';

/**
 * A lesson's transcript, as lines with their words timed.
 *
 * Shared rather than fetched where it is drawn: the transcript tab reads it, the
 * loop picker selects whole lines out of it, and a loop in the list shows the
 * passage it covers. Three readers, one parse — and one query, which the video's
 * own record already needed anyway.
 */
export function useTranscriptLines(videoId?: string) {
  const { data: videoRes } = useVideo(videoId ?? '', Boolean(videoId));
  const video = videoRes?.video;

  const ready = Boolean(videoId) && video?.subtitleStatus === 'READY';
  const { data: subtitles } = useSubtitles(videoId ?? '', ready);

  const lines = useMemo(() => {
    if (!subtitles?.content) return [];
    return buildTranscriptLines(parseVtt(subtitles.content), subtitles.words);
  }, [subtitles]);

  return { lines, video, hasTranscript: lines.length > 0 };
}
