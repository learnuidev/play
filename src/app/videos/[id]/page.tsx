"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { StreamResponse, SubtitleResponse, Video } from "@/types";
import { TRANSLATION_LANGUAGES } from "@/types";
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
  const [translating, setTranslating] = useState(false);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(
    TRANSLATION_LANGUAGES.map((l) => l.bcp47),
  );
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

  function toggleLanguage(bcp47: string) {
    setSelectedLanguages((prev) =>
      prev.includes(bcp47)
        ? prev.filter((l) => l !== bcp47)
        : [...prev, bcp47],
    );
  }

  async function handleGenerateTranslations() {
    if (selectedLanguages.length === 0) return;
    setTranslating(true);
    setError(null);
    try {
      await api.generateTranslations(videoId, selectedLanguages);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate translations",
      );
    } finally {
      setTranslating(false);
    }
  }

  const subtitleStatus = video?.subtitleStatus ?? "NONE";
  const showSubtitleAction =
    video?.status === "READY" &&
    subtitleStatus !== "READY" &&
    subtitleStatus !== "GENERATING";

  const tracks = (subtitle?.tracks ?? []).map((track) => ({
    src: track.subtitleUrl,
    srcLang: track.language,
    label: track.label,
  }));

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

                {subtitleStatus === "READY" && (
                  <div className="translations-row">
                    <span className="desc">Translate subtitles into:</span>
                    <div className="translation-options">
                      {TRANSLATION_LANGUAGES.map((lang) => {
                        const translation = video.translations?.[lang.bcp47];
                        const checked = selectedLanguages.includes(lang.bcp47);
                        return (
                          <label
                            key={lang.bcp47}
                            className="translation-option"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleLanguage(lang.bcp47)}
                              disabled={translating}
                            />
                            <span>{lang.label}</span>
                            {translation && (
                              <span className={`translation-status status-${translation.status.toLowerCase()}`}>
                                {translation.status === "READY"
                                  ? "Ready"
                                  : translation.status === "GENERATING"
                                    ? "Generating…"
                                    : translation.status === "FAILED"
                                      ? "Failed"
                                      : ""}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleGenerateTranslations}
                      disabled={translating || selectedLanguages.length === 0}
                    >
                      {translating ? "Translating…" : "Generate translations"}
                    </button>
                  </div>
                )}
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
