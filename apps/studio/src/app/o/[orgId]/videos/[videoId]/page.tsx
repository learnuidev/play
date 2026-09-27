'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EyeIcon } from 'lucide-react';
import { useVideo } from '@/modules/video/video.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageCard } from '@/components/shell/page-card';
import { VideoStatusBadge } from '@/components/video/status-badge';
import { VideoGeneralInfo } from '@/components/video/video-general-info';
import { VideoGeneralForm } from '@/components/video/video-general-form';
import { VideoThumbnail } from '@/components/video/video-thumbnail';
import { VideoTranscriptions } from '@/components/video/video-transcriptions';

export default function VideoPage() {
  const { orgId, videoId } = useParams<{ orgId: string; videoId: string }>();
  const { data, isError, error } = useVideo(videoId);
  const video = data?.video;

  return (
    <PageCard
      title={video?.title ?? 'Video'}
      description={video?.fileName}
      actions={
        <>
          {video && <VideoStatusBadge status={video.status} />}
          {video?.status === 'READY' && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/o/${orgId}/videos/${videoId}/preview`}>
                <EyeIcon />
                Preview
              </Link>
            </Button>
          )}
        </>
      }
    >
      {isError && (
        <p className="mb-4 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load video'}
        </p>
      )}

      {!video ? (
        <div className="grid gap-6">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : (
        <Tabs defaultValue="general">
          <TabsList className="mb-6">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="thumbnail">Thumbnail</TabsTrigger>
            <TabsTrigger value="transcriptions">Transcriptions</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <div className="grid gap-6">
              <VideoGeneralInfo video={video} />
              <VideoGeneralForm video={video} />
            </div>
          </TabsContent>
          <TabsContent value="thumbnail">
            <VideoThumbnail video={video} />
          </TabsContent>
          <TabsContent value="transcriptions">
            <VideoTranscriptions video={video} />
          </TabsContent>
        </Tabs>
      )}
    </PageCard>
  );
}
