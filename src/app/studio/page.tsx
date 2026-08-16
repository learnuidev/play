'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { Video, VideoStatus } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StudioPageHeader } from '@/components/studio/page-header';
import { VideoCard } from '@/components/studio/video-card';

const POLL_INTERVAL_MS = 5000;

const FILTERS: Array<VideoStatus | 'ALL'> = ['ALL', 'READY', 'PROCESSING', 'UPLOADING', 'FAILED'];

function filterLabel(f: VideoStatus | 'ALL'): string {
  return f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase();
}

export default function StudioPage() {
  const [filter, setFilter] = useState<VideoStatus | 'ALL'>('ALL');
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listVideos(filter === 'ALL' ? undefined : filter);
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

  return (
    <div className="flex h-svh flex-col">
      <StudioPageHeader
        title="Videos"
        description="Upload, transcribe, subtitle, and publish."
        actions={
          <Button size="sm" asChild>
            <Link href="/studio/new">
              <PlusIcon />
              New video
            </Link>
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-6">
          <div className="mb-6 flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors',
                  filter === f && 'bg-background text-foreground shadow-sm',
                )}
              >
                {filterLabel(f)}
              </button>
            ))}
          </div>

          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          {loading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-3 overflow-hidden rounded-2xl border">
                  <Skeleton className="aspect-video rounded-none" />
                  <div className="flex flex-col gap-2 p-4">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : videos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl border bg-muted/40">
                <PlusIcon className="size-7 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No videos yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upload your first video to start streaming.
                </p>
              </div>
              <Button asChild>
                <Link href="/studio/new">
                  <PlusIcon />
                  New video
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {videos.map((video) => (
                <VideoCard key={video.videoId} video={video} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
