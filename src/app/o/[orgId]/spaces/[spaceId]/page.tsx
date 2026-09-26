'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftIcon, CalendarClockIcon, CirclePlayIcon, PlusIcon } from 'lucide-react';
import { useSpace, useSpaceThumbnail } from '@/modules/space/space.queries';
import { useSections } from '@/modules/section/section.queries';
import { useOrganization } from '@/modules/organization/organization.queries';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PageCard } from '@/components/shell/page-card';
import { SpaceAvatar, spaceAccentColor } from '@/components/space/space-avatar';
import { SpaceTypeBadge } from '@/components/space/space-type-badge';
import { spaceScheduleLabel } from '@/components/space/space-card';
import { ContentOutline } from '@/components/content/content-outline';
import { SectionDialog } from '@/components/content/section-dialog';

export default function SpacePage() {
  const { orgId, spaceId } = useParams<{ orgId: string; spaceId: string }>();
  const { data, isLoading, isError, error } = useSpace(spaceId);
  const space = data?.space;

  const { data: cover } = useSpaceThumbnail(spaceId, Boolean(space?.thumbnailKey));

  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== 'VIEWER' : false;

  const { data: outline, isLoading: outlineLoading } = useSections(spaceId);
  const sections = outline?.sections ?? [];

  if (isError) {
    return (
      <PageCard title="Space">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load this space'}
        </p>
      </PageCard>
    );
  }

  if (isLoading || !space) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  const accent = spaceAccentColor(space);
  const scheduled = space.type === 'SCHEDULED';

  return (
    <div className="grid gap-6">
      <section className="overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm">
        <div
          className="relative h-40 w-full"
          style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}55 100%)` }}
        >
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover.thumbnailUrl}
              alt={space.title}
              className="absolute inset-0 size-full object-cover"
            />
          )}
        </div>

        <div className="flex flex-col gap-4 p-5">
          <Button variant="ghost" size="sm" className="w-fit -ml-2" asChild>
            <Link href={`/o/${orgId}/spaces`}>
              <ArrowLeftIcon />
              All spaces
            </Link>
          </Button>

          <div className="flex items-start gap-4">
            <SpaceAvatar space={space} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">{space.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SpaceTypeBadge type={space.type} />
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {scheduled ? (
                    <CalendarClockIcon className="size-3.5" />
                  ) : (
                    <CirclePlayIcon className="size-3.5" />
                  )}
                  {spaceScheduleLabel(space)}
                </span>
              </div>
            </div>
          </div>

          {space.description ? (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {space.description}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No description yet.</p>
          )}
        </div>
      </section>

      <PageCard
        title="Content"
        description="The sections this space publishes, and what is filed under them."
        actions={
          canEdit && sections.length > 0 ? (
            <SectionDialog
              spaceId={spaceId}
              trigger={
                <Button size="sm">
                  <PlusIcon />
                  New section
                </Button>
              }
            />
          ) : undefined
        }
      >
        {outlineLoading ? (
          <div className="grid gap-4">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        ) : (
          <ContentOutline
            orgId={orgId}
            spaceId={spaceId}
            sections={sections}
            truncated={outline?.truncated ?? false}
            canEdit={canEdit}
          />
        )}
      </PageCard>
    </div>
  );
}
