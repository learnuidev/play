'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EyeIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { Video } from '@/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StudioPageHeader } from '@/components/studio/page-header';
import { VideoStatusBadge } from '@/components/studio/status-badge';
import { VideoGeneralForm } from '@/components/studio/video-general-form';
import { VideoTranscriptions } from '@/components/studio/video-transcriptions';

const POLL_INTERVAL_MS = 5000;

export default function VideoPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getVideo(videoId);
      setVideo(res.video);
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
    const needsPoll =
      video.status === 'UPLOADING' ||
      video.status === 'PROCESSING' ||
      video.subtitleStatus === 'GENERATING';
    if (!needsPoll) return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [video, load]);

  return (
    <div className="flex h-svh flex-col">
      <StudioPageHeader
        title={video?.title ?? 'Video'}
        description={video?.fileName}
        actions={
          <>
            {video && <VideoStatusBadge status={video.status} />}
            {video?.status === 'READY' && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/studio/${videoId}/preview`}>
                  <EyeIcon />
                  Preview
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          {!video ? (
            <div className="grid gap-6">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          ) : (
            <Tabs defaultValue="general">
              <TabsList className="mb-6">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="transcriptions">Transcriptions</TabsTrigger>
              </TabsList>
              <TabsContent value="general">
                <VideoGeneralForm video={video} onSaved={load} />
              </TabsContent>
              <TabsContent value="transcriptions">
                <VideoTranscriptions video={video} onSaved={load} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
