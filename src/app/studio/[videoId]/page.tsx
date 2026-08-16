'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EyeIcon } from 'lucide-react';
import { useVideo } from '@/modules/video/video.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StudioPageHeader } from '@/components/studio/page-header';
import { VideoStatusBadge } from '@/components/studio/status-badge';
import { VideoGeneralForm } from '@/components/studio/video-general-form';
import { VideoTranscriptions } from '@/components/studio/video-transcriptions';

export default function VideoPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const { data, isError, error } = useVideo(videoId);
  const video = data?.video;

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
          {isError && (
            <p className="mb-4 text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load video'}
            </p>
          )}

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
                <VideoGeneralForm video={video} />
              </TabsContent>
              <TabsContent value="transcriptions">
                <VideoTranscriptions video={video} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
