'use client';

import Link from 'next/link';
import { BuildingIcon, PlusIcon } from 'lucide-react';
import { useOrganizations } from '@/modules/organization/organization.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StudioPageHeader } from '@/components/studio/page-header';
import { OrganizationCard } from '@/components/studio/organization-card';

export default function OrganizationsPage() {
  const { data, isLoading, isError, error } = useOrganizations();
  const organizations = data?.organizations ?? [];

  return (
    <div className="flex h-svh flex-col">
      <StudioPageHeader
        title="Organizations"
        description="Group courses and teammates under one organization."
        actions={
          <Button size="sm" asChild>
            <Link href="/studio/organizations/new">
              <PlusIcon />
              New organization
            </Link>
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-6">
          {isError && (
            <p className="mb-4 text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load organizations'}
            </p>
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
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
            <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl border bg-muted/40">
                <BuildingIcon className="size-7 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No organizations yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Create one to start managing courses and teammates.
                </p>
              </div>
              <Button asChild>
                <Link href="/studio/organizations/new">
                  <PlusIcon />
                  New organization
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {organizations.map((organization) => (
                <OrganizationCard key={organization.orgId} organization={organization} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
