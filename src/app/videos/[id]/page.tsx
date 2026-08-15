"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { StreamResponse, Video } from "@/types";
import { StatusBadge } from "@/components/status-badge";
import { VideoPlayer } from "@/components/video-player";

const POLL_INTERVAL_MS = 5000;

export default function VideoPage() {
  const params = useParams<{ id: string }>();
  const videoId = params.id;

  const [video, setVideo] = useState<Video | null>(null);
  const [stream, setStream] = useState<StreamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

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
    if (video.status !== "UPLOADING" && video.status !== "PROCESSING") return;
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
            />
          )}
          <div className="player-info">
            {video && (
              <>
                <h1>{video.title}</h1>
                <p>{video.description}</p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
