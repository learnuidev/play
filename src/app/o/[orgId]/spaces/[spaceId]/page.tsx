'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeftIcon, PlusIcon } from 'lucide-react';
import { useSpace, useSpaceThumbnail } from '@/modules/space/space.queries';
import { useSections } from '@/modules/section/section.queries';
import { useOrganization } from '@/modules/organization/organization.queries';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { BlockLabel } from '@/components/shell/page-card';
import { SpaceAvatar } from '@/components/space/space-avatar';
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
  const lessonCount = sections.reduce((total, section) => total + section.contents.length, 0);

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Failed to load this space'}
      </p>
    );
  }

  if (isLoading || !space) {
    return (
      <div className="grid gap-8">
        <Skeleton className="h-44 rounded-2xl" />
        <div className="grid gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  // What the course adds up to, above its name the way a subtitle reads. The
  // type is not repeated here: the line below already says how the space runs.
  const eyebrow = [
    sections.length > 0 ? `${sections.length} section${sections.length === 1 ? '' : 's'}` : null,
    lessonCount > 0 ? `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="grid gap-7 pb-4">
      <Link
        href={`/o/${orgId}/spaces`}
        className="-mb-2 inline-flex w-fit items-center gap-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Spaces
      </Link>

      <header className="grid gap-5">
        {/* A cover is the space's artwork. Without one the page is typography,
            which is what a space is anyway — an empty coloured slab would be
            decoration standing in for a photograph. */}
        {cover && (
          <div className="overflow-hidden rounded-2xl ring-1 ring-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover.thumbnailUrl} alt="" className="h-36 w-full object-cover sm:h-48" />
          </div>
        )}

        <div className="flex items-start gap-4">
          <SpaceAvatar space={space} size="lg" className="size-12 rounded-xl text-lg shadow-sm" />

          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {eyebrow}
              </p>
            )}
            <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {space.title}
            </h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{spaceScheduleLabel(space)}</p>

            {space.description && (
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
                {space.description}
              </p>
            )}
          </div>
        </div>
      </header>

      <section className="grid gap-3">
        {/* Nothing published means nothing to label: the block below says so
            itself, and the button that starts the course lives in it. */}
        {(outlineLoading || sections.length > 0) && (
          <BlockLabel
            action={
              canEdit && sections.length > 0 ? (
                <SectionDialog
                  spaceId={spaceId}
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-mr-2 h-7 gap-1 px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      <PlusIcon />
                      New section
                    </Button>
                  }
                />
              ) : undefined
            }
          >
            Content
          </BlockLabel>
        )}

        {outlineLoading ? (
          <div className="grid gap-3 py-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
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
      </section>
    </div>
  );
}
