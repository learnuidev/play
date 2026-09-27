"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon, FilmIcon, Loader2Icon, MusicIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAudio, useGenerateAudio, useStream, useVideo } from "@api/modules/video/video.queries";
import { useSubtitles } from "@api/modules/subtitle/subtitle.queries";
import { useThumbnail } from "@api/modules/thumbnail/thumbnail.queries";
import { parseVtt } from "@learning/lib/vtt";
import { Button } from "@ui/components/ui/button";
import { Skeleton } from "@ui/components/ui/skeleton";
import { VideoStatusBadge } from "@learning/components/video/status-badge";
import { AudioPlayer } from "@/components/audio-player";
import { VideoPlayer, type VideoPlayerHandle } from "@learning/components/video-player";
import { SubtitleTranscript } from "@/components/subtitle-transcript";

export default function PreviewPage() {
  const { orgId, videoId } = useParams<{ orgId: string; videoId: string }>();
  const { data: videoRes, isError, error } = useVideo(videoId);
  const video = videoRes?.video;
  const isReady = video?.status === "READY";

  const { data: stream } = useStream(videoId, isReady);
  const { data: subtitle } = useSubtitles(
    videoId,
    isReady && video?.subtitleStatus === "READY",
  );
  const { data: thumbnail } = useThumbnail(
    videoId,
    isReady && !!video?.thumbnailKey,
  );

  const [audioOnly, setAudioOnly] = useState(false);
  const hasAudio = isReady && !!video?.audioKey;
  const { data: audio } = useAudio(videoId, audioOnly && hasAudio);
  const generateAudio = useGenerateAudio(videoId);

  function handleGenerateAudio() {
    generateAudio.mutate(undefined, {
      onSuccess: () => toast.success('Audio extraction started'),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : 'Failed to generate audio'),
    });
  }

  const tracks = (subtitle?.tracks ?? []).map((track) => ({
    src: track.subtitleUrl,
    srcLang: track.language,
    label: track.label,
  }));

  const playerRef = useRef<VideoPlayerHandle>(null);

  const languages = useMemo(() => {
    const available = subtitle?.languages ?? [];
    if (available.length) return available;
    if (subtitle?.content) {
      return [
        {
          language: subtitle.sourceLanguage,
          label: subtitle.sourceLanguage.toLowerCase().startsWith("en")
            ? "English"
            : subtitle.sourceLanguage,
          isSource: true,
          content: subtitle.content,
        },
      ];
    }
    return [];
  }, [subtitle]);

  const [selectedLanguage, setSelectedLanguage] = useState<string>("");

  useEffect(() => {
    const match = languages.find(
      (lang) => lang.language.toLowerCase() === selectedLanguage.toLowerCase(),
    );
    if (!match) setSelectedLanguage(languages[0]?.language ?? "");
  }, [languages, selectedLanguage]);

  const cues = useMemo(() => {
    const lang = languages.find(
      (l) => l.language.toLowerCase() === selectedLanguage.toLowerCase(),
    );
    return lang ? parseVtt(lang.content) : [];
  }, [languages, selectedLanguage]);

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);

  const handleTimeUpdate = useCallback((timeMs: number) => {
    setCurrentTimeMs(timeMs);
  }, []);

  const handlePlay = useCallback(() => setPlaying(true), []);
  const handlePause = useCallback(() => setPlaying(false), []);

  const handleSeek = useCallback((timeMs: number) => {
    playerRef.current?.seekTo(timeMs);
    setCurrentTimeMs(timeMs);
  }, []);

  const handleActiveTrackChange = useCallback(
    (language: string | null) => {
      if (!language) return;
      const match = languages.find(
        (lang) => lang.language.toLowerCase() === language.toLowerCase(),
      );
      if (match) setSelectedLanguage(match.language);
    },
    [languages],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{video?.title ?? "Preview"}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {isReady ? "Final video preview" : "This video is still processing."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {video && <VideoStatusBadge status={video.status} />}
          <Button size="sm" variant="outline" asChild>
            <Link href={`/o/${orgId}/videos/${videoId}`}>
              <ArrowLeftIcon />
              Back
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {isError && (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load preview"}
          </p>
        )}

        <div className="sticky top-0 z-20 bg-muted/30 pb-4 pt-2">
          {!video ? (
            <Skeleton className="mx-auto aspect-video w-full max-w-5xl rounded-2xl" />
          ) : video.status !== "READY" ? (
            <div className="mx-auto flex aspect-video w-full max-w-5xl flex-col items-center justify-center gap-4 rounded-2xl border bg-muted/20 text-center">
              <FilmIcon className="size-10 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Not ready yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This video is still processing. Check back once encoding
                  finishes.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-5xl">
              {video.audioKey ? (
                <div className="mb-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={audioOnly ? "outline" : "default"}
                    onClick={() => setAudioOnly(false)}
                  >
                    <FilmIcon />
                    Video
                  </Button>
                  <Button
                    size="sm"
                    variant={audioOnly ? "default" : "outline"}
                    onClick={() => setAudioOnly(true)}
                  >
                    <MusicIcon />
                    Audio only
                  </Button>
                </div>
              ) : (
                <div className="mb-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleGenerateAudio}
                    disabled={
                      video.audioStatus === "GENERATING" || generateAudio.isPending
                    }
                  >
                    {video.audioStatus === "GENERATING" || generateAudio.isPending ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <MusicIcon />
                    )}
                    {video.audioStatus === "GENERATING"
                      ? "Generating audio…"
                      : video.audioStatus === "FAILED"
                        ? "Regenerate audio"
                        : "Generate audio"}
                  </Button>
                </div>
              )}

              {audioOnly ? (
                audio ? (
                  <div className="rounded-3xl border border-border/60 bg-card p-6">
                    <AudioPlayer
                      ref={playerRef}
                      src={audio.audioUrl}
                      initialTimeMs={currentTimeMs}
                      autoPlay={playing}
                      onPlay={handlePlay}
                      onPause={handlePause}
                      onTimeUpdate={handleTimeUpdate}
                    />
                  </div>
                ) : (
                  <Skeleton className="h-16 w-full rounded-2xl" />
                )
              ) : stream ? (
                <div className="bg-transparent">
                  <VideoPlayer
                    ref={playerRef}
                    src={stream.manifestUrl}
                    signedQuery={stream.signedQuery}
                    poster={playing ? undefined : thumbnail?.thumbnailUrl}
                    initialTimeMs={currentTimeMs}
                    autoPlay={playing}
                    initialTrackLanguage={selectedLanguage}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    tracks={tracks}
                    onTimeUpdate={handleTimeUpdate}
                    onActiveTrackChange={handleActiveTrackChange}
                  />
                </div>
              ) : (
                <Skeleton className="mx-auto aspect-video w-full rounded-2xl" />
              )}
            </div>
          )}
        </div>

        <div className="mx-auto w-full max-w-5xl pb-6">
          {video && video.status === "READY" && languages.length > 0 && (
            <SubtitleTranscript
              cues={cues}
              currentTimeMs={currentTimeMs}
              onSeek={handleSeek}
            />
          )}
        </div>
      </div>
    </div>
  );
}
