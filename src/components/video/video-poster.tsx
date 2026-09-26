'use client';

import { PlayIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThumbnail } from '@/modules/thumbnail/thumbnail.queries';
import type { Video } from '@/types';

/**
 * A video's poster, at the size a list row needs.
 *
 * Deliberately not `VideoThumbnail`, which is the management card on a video's
 * own page — upload, recapture, status. This one only ever draws the image, so
 * a picker listing twenty videos is twenty posters rather than twenty cards.
 * When there is no poster yet it draws the icon it would have been recognised
 * by anyway.
 */
export function VideoPoster({ video, className }: { video: Video; className?: string }) {
  const { data } = useThumbnail(video.videoId, Boolean(video.thumbnailKey));

  return (
    <span
      className={cn(
        'relative block aspect-video shrink-0 overflow-hidden rounded-md border bg-muted',
        className,
      )}
    >
      {data?.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <PlayIcon className="size-3.5" />
        </span>
      )}
    </span>
  );
}
