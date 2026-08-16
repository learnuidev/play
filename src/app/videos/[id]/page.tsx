"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { StreamResponse, SubtitleResponse, Video } from "@/types";
import { StatusBadge } from "@/components/status-badge";
import { SubtitleEditor } from "@/components/subtitle-editor";
import { VideoPlayer } from "@/components/video-player";

const POLL_INTERVAL_MS = 5000;

export default function VideoPage() {
  const params = useParams<{ id: string }>();
  const videoId = params.id;

  const [video, setVideo] = useState<Video | null>(null);
  const [stream, setStream] = useState<StreamResponse | null>(null);
  const [subtitle, setSubtitle] = useState<SubtitleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const videoRes = await api.getVideo(videoId);
      setVideo(videoRes.video);

      if (videoRes.video.status === "READY") {
        const streamRes = await api.getStream(videoId);
        setStream(streamRes);
      } else {
        setStream(null);
      }

      if (
        videoRes.video.status === "READY" &&
        videoRes.video.subtitleStatus === "READY" &&
        videoRes.video.subtitleKey
      ) {
        const subtitleRes = await api.getSubtitles(videoId);
        setSubtitle(subtitleRes);
      } else {
        setSubtitle(null);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load video");
    }
  }, [videoId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!video) return;
    const needsPoll =
      video.status === "UPLOADING" ||
      video.status === "PROCESSING" ||
      video.subtitleStatus === "GENERATING";
    if (!needsPoll) return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [video, load]);

  async function handleRetry() {
    setRetrying(true);
    setError(null);
    try {
      await api.retryVideo(videoId);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to retry processing",
      );
    } finally {
      setRetrying(false);
    }
  }

  async function handleGenerateSubtitles() {
    setGenerating(true);
    setError(null);
    try {
      await api.generateSubtitles(videoId);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate subtitles",
      );
    } finally {
      setGenerating(false);
    }
  }

  const subtitleStatus = video?.subtitleStatus ?? "NONE";
  const showSubtitleAction =
    video?.status === "READY" &&
    subtitleStatus !== "READY" &&
    subtitleStatus !== "GENERATING";

  const tracks =
    subtitle && video?.subtitleLanguage
      ? [
          {
            src: subtitle.subtitleUrl,
            srcLang: video.subtitleLanguage,
            label: video.subtitleLanguage === "en-US" ? "English" : video.subtitleLanguage,
          },
        ]
      : [];

  return (
    <div className="player-page">
      <header className="app-header">
        <Link href="/" className="btn">
          ← Back
        </Link>
        {video && <StatusBadge status={video.status} />}
      </header>

      {error && <p className="error-text">{error}</p>}

      {video && video.status !== "READY" ? (
        <div className="empty-state">
          <h2>{video.title}</h2>
          {video.status === "FAILED" ? (
            <>
              <p>This video failed to process.</p>
              <button
                className="btn btn-primary"
                onClick={handleRetry}
                disabled={retrying}
              >
                {retrying ? "Retrying…" : "Retry processing"}
              </button>
            </>
          ) : (
            <p>
              This video is still being processed (status:{" "}
              <strong>{video.status}</strong>). It will be available to stream
              once encoding finishes.
            </p>
          )}
        </div>
      ) : (
        <>
          {stream && (
            <VideoPlayer
              src={stream.manifestUrl}
              signedQuery={stream.signedQuery}
              tracks={tracks}
            />
          )}
          <div className="player-info">
            {video && (
              <>
                <h1>{video.title}</h1>
                <p>{video.description}</p>
                <div className="subtitle-row">
                  <span className="desc">
                    Subtitles:{" "}
                    {subtitleStatus === "READY"
                      ? "Ready"
                      : subtitleStatus === "GENERATING"
                        ? "Generating…"
                        : subtitleStatus === "FAILED"
                          ? "Failed"
                          : "None"}
                  </span>
                  {subtitleStatus === "GENERATING" && (
                    <span className="desc">Subtitle generation in progress…</span>
                  )}
                  {subtitleStatus === "READY" && (
                    <button className="btn" onClick={() => setEditing((v) => !v)}>
                      {editing ? "Close editor" : "Edit subtitles"}
                    </button>
                  )}
                  {showSubtitleAction && (
                    <button
                      className="btn btn-primary"
                      onClick={handleGenerateSubtitles}
                      disabled={generating}
                    >
                      {generating
                        ? "Starting…"
                        : subtitleStatus === "FAILED"
                          ? "Regenerate subtitles"
                          : "Generate subtitles"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {editing && subtitle && (
            <SubtitleEditor
              videoId={videoId}
              initialContent={subtitle.content}
              onSaved={load}
            />
          )}
        </>
      )}
    </div>
  );
}
