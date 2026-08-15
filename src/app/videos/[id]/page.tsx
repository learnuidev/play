'use client';

import videojs from 'video.js';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { StreamResponse, Video } from '@/types';
import { StatusBadge } from '@/components/status-badge';

type XhrOptions = { uri?: string };

interface VhsXhr {
  onRequest(cb: (options: XhrOptions) => XhrOptions): void;
  offRequest(cb: (options: XhrOptions) => XhrOptions): void;
}

export default function VideoPage() {
  const params = useParams<{ id: string }>();
  const videoId = params.id;

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
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

    const vhsXhr = (videojs as unknown as { Vhs: { xhr: VhsXhr } }).Vhs.xhr;

    const appendSignature = (options: XhrOptions): XhrOptions => {
      if (options.uri && !options.uri.includes('Policy=')) {
        const separator = options.uri.includes('?') ? '&' : '?';
        options.uri = `${options.uri}${separator}${stream.signedQuery}`;
      }
      return options;
    };

    vhsXhr.onRequest(appendSignature);

    const player = videojs(el, {
      controls: true,
      responsive: true,
      fluid: true,
      preload: 'auto',
      playsinline: true,
      sources: [{ src: stream.manifestUrl, type: 'application/x-mpegurl' }],
    });

    playerRef.current = player;

    player.on('error', () => {
      const err = player.error();
      if (err) setError(err.message || 'Failed to play stream');
    });

    return () => {
      vhsXhr.offRequest(appendSignature);
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
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
          <div data-vjs-player>
            <video ref={videoRef} className="video-js vjs-big-play-centered" playsInline />
          </div>
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
