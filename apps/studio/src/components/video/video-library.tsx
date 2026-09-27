'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PlusIcon, VideoIcon } from 'lucide-react';
import type { VideoStatus } from '@play/types';
import { useVideos } from '@api/modules/video/video.queries';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { VideoCard } from '@/components/video/video-card';
import { EmptyState } from '@/components/shell/page-card';

const FILTERS: Array<VideoStatus | 'ALL'> = ['ALL', 'READY', 'PROCESSING', 'UPLOADING', 'FAILED'];

function filterLabel(f: VideoStatus | 'ALL'): string {
  return f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase();
}

/**
 * The organization's video library. Every member can see it regardless of who
 * uploaded what; uploading requires the admin or editor role.
 */
export function VideoLibrary({ orgId, canUpload }: { orgId: string; canUpload: boolean }) {
  const [filter, setFilter] = useState<VideoStatus | 'ALL'>('ALL');
  const { data, isLoading, isError, error } = useVideos(filter, orgId);
  const videos = data?.videos ?? [];

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
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

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load videos'}
        </p>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
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
        <EmptyState
          icon={<VideoIcon className="size-5 text-muted-foreground" />}
          title={
            filter === 'ALL'
              ? 'No videos in this organization'
              : `No ${filterLabel(filter).toLowerCase()} videos`
          }
          description="Videos uploaded here are visible to every member of the organization."
          action={
            canUpload && filter === 'ALL' ? (
              <Button asChild>
                <Link href={`/o/${orgId}/videos/new`}>
                  <PlusIcon />
                  Upload video
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <VideoCard key={video.videoId} video={video} orgId={orgId} />
          ))}
        </div>
      )}
    </div>
  );
}
