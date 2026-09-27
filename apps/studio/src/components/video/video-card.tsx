'use client';

import Link from 'next/link';
import { EyeIcon, PlayIcon } from 'lucide-react';
import type { Video } from '@play/types';
import { Button } from '@ui/components/ui/button';
import { useThumbnail } from '@api/modules/thumbnail/thumbnail.queries';
import { VideoStatusBadge } from '@learning/components/video/status-badge';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * `orgId` comes from the route rather than `video.organizationId`, so a video
 * created before organizations existed (and not yet backfilled) still links
 * into the community being browsed.
 */
export function VideoCard({ video, orgId }: { video: Video; orgId: string }) {
  const thumbnailReady = !!video.thumbnailKey;
  const { data: thumbnail } = useThumbnail(video.videoId, thumbnailReady);
  const href = `/o/${orgId}/videos/${video.videoId}`;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-xl">
      <Link href={href} className="relative aspect-video overflow-hidden bg-zinc-900">
        {thumbnail ? (
          <img
            src={thumbnail.thumbnailUrl}
            alt={video.title}
            className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black" />
        )}
        {!thumbnail && (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--muted)_0%,transparent_70%)] opacity-20" />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <PlayIcon className="size-12 text-white/30 transition-all duration-300 group-hover:scale-110 group-hover:text-white/70" />
        </div>
        <VideoStatusBadge status={video.status} className="absolute left-3 top-3" />
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link
          href={href}
          className="line-clamp-1 text-sm font-semibold transition-colors hover:underline"
        >
          {video.title}
        </Link>
        <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
          {video.description || 'No description'}
        </p>
        <p className="mt-auto text-xs text-muted-foreground">
          {video.resolutionTier ? `${video.resolutionTier} · ` : ''}
          {formatBytes(video.size)} · {formatDate(video.createdAt)}
        </p>

        <div className="mt-2 flex items-center gap-1.5">
          <Button variant="secondary" size="sm" className="flex-1" asChild>
            <Link href={href}>Open</Link>
          </Button>
          {video.status === 'READY' && (
            <Button variant="ghost" size="icon" aria-label="Preview" asChild>
              <Link href={`${href}/preview`}>
                <EyeIcon />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
