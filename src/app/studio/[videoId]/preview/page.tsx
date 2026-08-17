"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon, FilmIcon, MusicIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAudio, useStream, useVideo } from "@/modules/video/video.queries";
import { useSubtitles } from "@/modules/subtitle/subtitle.queries";
import { useThumbnail } from "@/modules/thumbnail/thumbnail.queries";
import { parseVtt } from "@/lib/vtt";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StudioPageHeader } from "@/components/studio/page-header";
import { VideoStatusBadge } from "@/components/studio/status-badge";
import { AudioPlayer } from "@/components/audio-player";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video-player";
import { SubtitleTranscript } from "@/components/subtitle-transcript";

export default function PreviewPage() {
  const { videoId } = useParams<{ videoId: string }>();
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

  const handleTimeUpdate = useCallback((timeMs: number) => {
    setCurrentTimeMs(timeMs);
  }, []);

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
    <div className="flex h-svh flex-col">
      <StudioPageHeader
        title={video?.title ?? "Preview"}
        description={isReady ? "Final video preview" : undefined}
        actions={
          <>
            {video && <VideoStatusBadge status={video.status} />}
            <Button size="sm" variant="outline" asChild>
              <Link href={`/studio/${videoId}`}>
                <ArrowLeftIcon />
                Back
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl pt-6">
          {isError && (
            <p className="mb-4 text-sm text-destructive">
              {error instanceof Error
                ? error.message
                : "Failed to load preview"}
            </p>
          )}

          {video && video.status === "READY" && (
            <div className="mb-4 grid gap-1">
              <h2 className="text-base font-semibold">{video.title}</h2>
              {video.description && (
                <p className="text-sm text-muted-foreground">
                  {video.description}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="sticky top-0 z-20 bg-background pb-4 pt-2">
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
              {video.audioKey && (
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
              )}

              {audioOnly ? (
                audio ? (
                  <div className="rounded-2xl border bg-card p-6">
                    <AudioPlayer
                      ref={playerRef}
                      src={audio.audioUrl}
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
                    poster={thumbnail?.thumbnailUrl}
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
