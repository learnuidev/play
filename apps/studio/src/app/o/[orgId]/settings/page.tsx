'use client';

import { useParams } from 'next/navigation';
import { ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS } from '@play/types';
import { useOrganization } from '@api/modules/organization/organization.queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui/card';
import { Skeleton } from '@ui/components/ui/skeleton';
import { PageCard } from '@/components/shell/page-card';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function OrganizationSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data, isLoading, isError, error } = useOrganization(orgId);
  const organization = data?.organization;

  if (isError) {
    return (
      <PageCard title="Settings">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load this organization'}
        </p>
      </PageCard>
    );
  }

  return (
    <PageCard title="Organization settings" description="Details of this organization.">
      {isLoading || !organization ? (
        <div className="grid gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-6">
          <dl className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="truncate font-medium">{organization.name}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="truncate font-mono text-xs">{organization.slug}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">Description</dt>
              <dd className="text-right">{organization.description || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">{formatDate(organization.createdAt)}</dd>
            </div>
          </dl>

          <Card className="rounded-2xl border-dashed">
            <CardHeader>
              <CardTitle className="text-sm">Your role</CardTitle>
              <CardDescription>{ORG_ROLE_LABELS[organization.role]}</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {ORG_ROLE_DESCRIPTIONS[organization.role]}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Renaming an organization and changing its description are not built yet.
          </p>
        </div>
      )}
    </PageCard>
  );
}
