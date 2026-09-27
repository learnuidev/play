'use client';

import Link from 'next/link';
import { BuildingIcon, PlusIcon } from 'lucide-react';
import { useOrganizations } from '@/modules/organization/organization.queries';
import { useMyInvitations } from '@/modules/organization/member.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { OrganizationCard } from '@/components/organization/organization-card';
import { PendingInvitationsCard } from '@/components/organization/pending-invitations-card';

export default function OrganizationsPage() {
  const { data, isLoading, isError, error } = useOrganizations();
  const { data: invitationData } = useMyInvitations();
  const organizations = data?.organizations ?? [];
  const invitations = invitationData?.invitations ?? [];

  return (
    <div className="grid gap-6">
      {/* Above the communities, because it is the one thing here addressed to
          somebody who is not in any of them yet. */}
      <PendingInvitationsCard invitations={invitations} />

      <PageCard
        title="Organizations"
        description="Every community you belong to."
        actions={
          <Button size="sm" asChild>
            <Link href="/organizations/new">
              <PlusIcon />
              New organization
            </Link>
          </Button>
        }
      >
        {isError && (
          <p className="mb-4 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load organizations'}
          </p>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-2xl border p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : organizations.length === 0 ? (
          <EmptyState
            icon={<BuildingIcon className="size-5 text-muted-foreground" />}
            title="No organizations yet"
            description={
              invitations.length > 0
                ? 'Accept an invitation above, or create a community of your own.'
                : 'Create one to start uploading videos and inviting teammates.'
            }
            action={
              <Button asChild>
                <Link href="/organizations/new">
                  <PlusIcon />
                  New organization
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {organizations.map((organization) => (
              <OrganizationCard key={organization.orgId} organization={organization} />
            ))}
          </div>
        )}
      </PageCard>
    </div>
  );
}
