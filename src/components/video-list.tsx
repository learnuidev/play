'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Video, VideoStatus } from '@/types';
import { StatusBadge } from './status-badge';

const POLL_INTERVAL_MS = 5000;

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function VideoList({ status }: { status: VideoStatus | 'ALL' }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filter = status === 'ALL' ? undefined : status;

  const load = useCallback(async () => {
    try {
      const res = await api.listVideos(filter);
      setVideos(res.videos);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    const hasInProgress = videos.some((v) => v.status === 'UPLOADING' || v.status === 'PROCESSING');
    if (!hasInProgress) return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [videos, load]);

  async function handleDelete(videoId: string) {
    if (!window.confirm('Delete this video and its files?')) return;
    try {
      await api.deleteVideo(videoId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete video');
    }
  }

  if (loading) return <div className="empty-state">Loading…</div>;
  if (error) return <div className="empty-state error-text">{error}</div>;
  if (videos.length === 0) return <div className="empty-state">No videos yet. Upload one above.</div>;

  return (
    <div className="video-grid">
      {videos.map((video) => (
        <div className="video-card" key={video.videoId}>
          <StatusBadge status={video.status} />
          <h3>{video.title}</h3>
          <div className="desc">{video.description || '—'}</div>
          <div className="meta">
            {video.fileName}
            <br />
            {formatBytes(video.size)} · {formatDate(video.createdAt)}
          </div>
          <div className="actions">
            {video.status === 'READY' && (
              <Link className="btn btn-primary" href={`/videos/${video.videoId}`}>
                Stream
              </Link>
            )}
            <button className="btn btn-danger" onClick={() => handleDelete(video.videoId)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
