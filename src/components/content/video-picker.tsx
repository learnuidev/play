'use client';

import { useMemo, useState } from 'react';
import { CheckIcon, SearchIcon, VideoOffIcon } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import { useVideos } from '@/modules/video/video.queries';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { VideoPoster } from '@/components/video/video-poster';
import { VideoStatusBadge } from '@/components/video/status-badge';
import type { Video } from '@/types';

/**
 * Picks the video a piece of content plays, out of the organization's own
 * library.
 *
 * The library is the whole choice on purpose: content is published to the
 * members of one organization, so a video from anywhere else would either be
 * unplayable for them or visible to nobody.
 */
export function VideoPicker({
  orgId,
  selectedId,
  onSelect,
}: {
  orgId: string;
  selectedId?: string;
  onSelect: (video: Video | null) => void;
}) {
  const { data, isLoading } = useVideos('ALL', orgId);
  const [filter, setFilter] = useState('');

  const videos = data?.videos ?? [];

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return videos;
    return videos.filter((video) => video.title.toLowerCase().includes(needle));
  }, [videos, filter]);

  if (isLoading) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center">
        <VideoOffIcon className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">No videos in this organization yet</p>
        <p className="text-xs text-muted-foreground">
          Upload one to the video library, then come back and attach it.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {videos.length > 5 && (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search the library"
            className="pl-8"
          />
        </div>
      )}

      <div className="max-h-64 overflow-y-auto rounded-md border">
        {matches.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing matches “{filter.trim()}”.
          </p>
        ) : (
          matches.map((video) => {
            const selected = video.videoId === selectedId;
            return (
              <button
                key={video.videoId}
                type="button"
                onClick={() => onSelect(selected ? null : video)}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-3 border-b px-2 py-2 text-left transition-colors last:border-b-0',
                  selected ? 'bg-accent' : 'hover:bg-muted/60',
                )}
              >
                <VideoPoster video={video} className="w-16" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{video.title}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <VideoStatusBadge status={video.status} />
                    {video.duration ? <span>{formatDuration(video.duration)}</span> : null}
                  </span>
                </span>
                {selected && <CheckIcon className="size-4 shrink-0 text-primary" />}
              </button>
            );
          })
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {selectedId ? 'Tap the selected video to unlink it.' : 'Optional — a lesson can be written before its video exists.'}
      </p>
    </div>
  );
}
