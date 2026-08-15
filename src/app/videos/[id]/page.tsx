'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import Hls from 'hls.js';
import { api } from '@/lib/api';
import type { StreamResponse, Video } from '@/types';
import { StatusBadge } from '@/components/status-badge';

const POLL_INTERVAL_MS = 5000;

type PlayerElement = HTMLVideoElement & { api?: Hls | null };

interface QualityLevel {
  index: number;
  height: number;
  label: string;
}

export default function VideoPage() {
  const params = useParams<{ id: string }>();
  const videoId = params.id;

  const playerRef = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [stream, setStream] = useState<StreamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(-1);

  const load = useCallback(async () => {
    try {
      const videoRes = await api.getVideo(videoId);
      setVideo(videoRes.video);
      if (videoRes.video.status === 'READY') {
        const streamRes = await api.getStream(videoId);
        setStream(streamRes);
      } else {
        setStream(null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    }
  }, [videoId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!video) return;
    if (video.status !== 'UPLOADING' && video.status !== 'PROCESSING') return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [video, load]);

  // Read the available HLS renditions from the underlying hls.js instance
  // once the player has loaded the manifest.
  useEffect(() => {
    setLevels([]);
    setSelectedLevel(-1);
    if (!stream) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const syncLevels = () => {
      const hls = (playerRef.current as PlayerElement | null)?.api;
      if (!hls || !hls.levels || hls.levels.length === 0) {
        if (attempts++ < 100 && !cancelled) timer = setTimeout(syncLevels, 150);
        return;
      }

      const seen = new Set<number>();
      const list: QualityLevel[] = [];
      hls.levels.forEach((level, index) => {
        const height = level.height || 0;
        if (!height || seen.has(height)) return;
        seen.add(height);
        list.push({ index, height, label: `${height}p` });
      });
      list.sort((a, b) => b.height - a.height);
      setLevels(list);
    };

    syncLevels();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [stream]);

  const handleQualityChange = (levelIndex: number) => {
    const hls = (playerRef.current as PlayerElement | null)?.api;
    if (!hls) return;
    // -1 enables automatic adaptive bitrate selection.
    hls.currentLevel = levelIndex;
    setSelectedLevel(levelIndex);
  };

  async function handleRetry() {
    setRetrying(true);
    setError(null);
    try {
      await api.retryVideo(videoId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry processing');
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

      {video && video.status !== 'READY' ? (
        <div className="empty-state">
          <h2>{video.title}</h2>
          {video.status === 'FAILED' ? (
            <>
              <p>This video failed to process.</p>
              <button className="btn btn-primary" onClick={handleRetry} disabled={retrying}>
                {retrying ? 'Retrying…' : 'Retry processing'}
              </button>
            </>
          ) : (
            <p>
              This video is still being processed (status: <strong>{video.status}</strong>). It
              will be available to stream once encoding finishes.
            </p>
          )}
        </div>
      ) : (
        <>
          {stream && (
            <div className="player-wrapper">
              <ReactPlayer
                ref={playerRef}
                src={stream.manifestUrl}
                controls
                playing
                playsInline
                width="100%"
                height="100%"
                config={{
                  hls: {
                    xhrSetup: (xhr, url) => {
                      if (!url.includes('Policy=')) {
                        const separator = url.includes('?') ? '&' : '?';
                        xhr.open('GET', `${url}${separator}${stream.signedQuery}`, true);
                      }
                    },
                  },
                }}
                onError={() => setError('Failed to play stream')}
              />
              {levels.length > 1 && (
                <div className="quality-selector">
                  <select
                    value={selectedLevel}
                    onChange={(e) => handleQualityChange(Number(e.target.value))}
                  >
                    <option value={-1}>Auto</option>
                    {levels.map((level) => (
                      <option key={level.index} value={level.index}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
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
