'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRightIcon, PlusIcon, VideoIcon } from 'lucide-react';
import { ORG_ROLE_LABELS } from '@/types';
import { useOrganization } from '@/modules/organization/organization.queries';
import { useVideos } from '@/modules/video/video.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { VideoCard } from '@/components/video/video-card';

const RECENT_VIDEOS = 3;

/** What the organization has, and what it will have. */
const SECTIONS = [
  {
    label: 'Videos',
    description: 'Every video this organization owns, watchable by all its members.',
    segment: 'videos',
  },
  {
    label: 'Spaces',
    description: 'Groups of courses and videos inside the organization.',
    segment: 'spaces',
  },
  {
    label: 'Members',
    description: 'Teammates invited as admin, editor, or viewer.',
    segment: 'members',
  },
] as const;

export default function OrganizationHomePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: orgData, isLoading: orgLoading, isError, error } = useOrganization(orgId);
  const organization = orgData?.organization;

  const { data: videoData, isLoading: videosLoading } = useVideos('ALL', orgId);
  const videos = videoData?.videos ?? [];

  const loading = orgLoading || videosLoading;
  const canUpload = organization ? organization.role !== 'VIEWER' : false;

  if (isError) {
    return (
      <PageCard title="Home">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load this organization'}
        </p>
      </PageCard>
    );
  }

  return (
    <div className="grid gap-6">
      <PageCard
        title="Recent videos"
        description={
          organization ? `${organization.name} · you are ${ORG_ROLE_LABELS[organization.role]}` : undefined
        }
        actions={
          videos.length > 0 ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/o/${orgId}/videos`}>
                View all
                <ArrowRightIcon />
              </Link>
            </Button>
          ) : undefined
        }
      >
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: RECENT_VIDEOS }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3 overflow-hidden rounded-2xl border">
                <Skeleton className="aspect-video rounded-none" />
                <div className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : videos.length === 0 ? (
          <EmptyState
            icon={<VideoIcon className="size-5 text-muted-foreground" />}
            title={organization ? `Welcome to ${organization.name}` : 'Welcome'}
            description={
              canUpload
                ? 'Upload your first video and it will show up here for everyone in the organization.'
                : 'Nothing has been uploaded to this organization yet.'
            }
            action={
              canUpload ? (
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
            {videos.slice(0, RECENT_VIDEOS).map((video) => (
              <VideoCard key={video.videoId} video={video} orgId={orgId} />
            ))}
          </div>
        )}
      </PageCard>

      <PageCard title="Getting started">
        <ul className="grid gap-3">
          {SECTIONS.map((section) => (
            <li key={section.segment}>
              <Link
                href={`/o/${orgId}/${section.segment}`}
                className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3 transition-colors hover:border-ring/40 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{section.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{section.description}</p>
                </div>
                <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </PageCard>
    </div>
  );
}
