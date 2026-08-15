'use client';

import Hls from 'hls.js';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { StreamResponse, Video } from '@/types';
import { StatusBadge } from '@/components/status-badge';

export default function VideoPage() {
  const params = useParams<{ id: string }>();
  const videoId = params.id;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [stream, setStream] = useState<StreamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const videoRes = await api.getVideo(videoId);
        if (cancelled) return;
        setVideo(videoRes.video);

        if (videoRes.video.status === 'READY') {
          const streamRes = await api.getStream(videoId);
          if (!cancelled) setStream(streamRes);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load video');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;

    let hls: Hls | undefined;

    if (Hls.isSupported()) {
      hls = new Hls({
        xhrSetup: (xhr, url) => {
          if (stream.signedQuery && !url.includes('Policy=')) {
            const separator = url.includes('?') ? '&' : '?';
            xhr.open('GET', `${url}${separator}${stream.signedQuery}`, true);
          }
        },
      });
      hls.loadSource(stream.manifestUrl);
      hls.attachMedia(el);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setError('Failed to play stream');
        }
      });
    } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = stream.manifestUrl;
    } else {
      setError('This browser does not support HLS playback');
    }

    return () => {
      hls?.destroy();
    };
  }, [stream]);

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
          <p>
            This video is still being processed (status: <strong>{video.status}</strong>). It will
            be available to stream once encoding finishes.
          </p>
        </div>
      ) : (
        <>
          <video ref={videoRef} controls playsInline />
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
