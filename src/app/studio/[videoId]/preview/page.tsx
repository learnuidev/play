'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftIcon, FilmIcon } from 'lucide-react';
import { useStream, useVideo } from '@/modules/video/video.queries';
import { useSubtitles } from '@/modules/subtitle/subtitle.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StudioPageHeader } from '@/components/studio/page-header';
import { VideoStatusBadge } from '@/components/studio/status-badge';
import { VideoPlayer } from '@/components/video-player';

export default function PreviewPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const { data: videoRes, isError, error } = useVideo(videoId);
  const video = videoRes?.video;
  const isReady = video?.status === 'READY';

  const { data: stream } = useStream(videoId, isReady);
  const { data: subtitle } = useSubtitles(
    videoId,
    isReady && video?.subtitleStatus === 'READY',
  );

  const tracks = (subtitle?.tracks ?? []).map((track) => ({
    src: track.subtitleUrl,
    srcLang: track.language,
    label: track.label,
  }));

  return (
    <div className="flex h-svh flex-col">
      <StudioPageHeader
        title={video?.title ?? 'Preview'}
        description={isReady ? 'Final video preview' : undefined}
        actions={
          <>
            {video && <VideoStatusBadge status={video.status} />}
            <Button size="sm" variant="outline" asChild>
              <Link href={`/studio/${videoId}`}>
                <ArrowLeftIcon />
                Back
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          {isError && (
            <p className="mb-4 text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load preview'}
            </p>
          )}

          {!video ? (
            <Skeleton className="aspect-video w-full rounded-2xl" />
          ) : video.status !== 'READY' ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-2xl border bg-muted/20 text-center">
              <FilmIcon className="size-10 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Not ready yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This video is still processing. Check back once encoding finishes.
                </p>
              </div>
            </div>
          ) : stream ? (
            <div className="overflow-hidden rounded-2xl border bg-black shadow-2xl">
              <VideoPlayer src={stream.manifestUrl} signedQuery={stream.signedQuery} tracks={tracks} />
            </div>
          ) : (
            <Skeleton className="aspect-video w-full rounded-2xl" />
          )}

          {video && video.status === 'READY' && (
            <div className="mt-4 grid gap-1">
              <h2 className="text-base font-semibold">{video.title}</h2>
              {video.description && (
                <p className="text-sm text-muted-foreground">{video.description}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
