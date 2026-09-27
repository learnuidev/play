'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LayoutGridIcon, PlusIcon } from 'lucide-react';
import { useOrganization } from '@api/modules/organization/organization.queries';
import { useSpaces } from '@api/modules/space/space.queries';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { SpaceCard } from '@learning/components/space/space-card';

const PLACEHOLDER_CARDS = 3;

export default function OrganizationSpacesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: orgData } = useOrganization(orgId);
  const organization = orgData?.organization;
  const canCreate = organization ? organization.role !== 'VIEWER' : false;

  const { data, isLoading, isError, error } = useSpaces(orgId);
  const spaces = data?.spaces ?? [];

  return (
    <PageCard
      title="Spaces"
      description={
        organization
          ? `Courses ${organization.name} publishes to its members.`
          : 'Courses this organization publishes.'
      }
      actions={
        canCreate && spaces.length > 0 ? (
          <Button size="sm" asChild>
            <Link href={`/o/${orgId}/spaces/new`}>
              <PlusIcon />
              New space
            </Link>
          </Button>
        ) : undefined
      }
    >
      {isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load spaces'}
        </p>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: PLACEHOLDER_CARDS }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3 overflow-hidden rounded-2xl border">
              <Skeleton className="aspect-video rounded-none" />
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : spaces.length === 0 ? (
        <EmptyState
          icon={<LayoutGridIcon className="size-5 text-muted-foreground" />}
          title="No spaces yet"
          description={
            canCreate
              ? 'A space is a course: a title, how it unfolds, and the videos that belong to it. Create the first one.'
              : 'Nothing has been published to this organization yet.'
          }
          action={
            canCreate ? (
              <Button asChild>
                <Link href={`/o/${orgId}/spaces/new`}>
                  <PlusIcon />
                  New space
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((space) => (
            <SpaceCard key={space.spaceId} href={`/o/${orgId}/spaces/${space.spaceId}`} space={space} />
          ))}
        </div>
      )}
    </PageCard>
  );
}
