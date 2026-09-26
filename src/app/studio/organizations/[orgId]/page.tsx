'use client';

import { useParams } from 'next/navigation';
import { BookOpenIcon, LockIcon, UsersIcon } from 'lucide-react';
import { ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS } from '@/types';
import { useOrganization } from '@/modules/organization/organization.queries';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StudioPageHeader } from '@/components/studio/page-header';

const ROLE_VARIANT = {
  ADMIN: 'default',
  EDITOR: 'secondary',
  VIEWER: 'outline',
} as const;

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function OrganizationPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data, isError, error } = useOrganization(orgId);
  const organization = data?.organization;

  return (
    <div className="flex h-svh flex-col">
      <StudioPageHeader
        title={organization?.name ?? 'Organization'}
        description={organization?.slug}
        actions={
          organization && (
            <Badge variant={ROLE_VARIANT[organization.role]}>
              {ORG_ROLE_LABELS[organization.role]}
            </Badge>
          )
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {isError && (
            <p className="mb-4 text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to load organization'}
            </p>
          )}

          {!organization ? (
            <div className="grid gap-6">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-48 w-full rounded-2xl" />
            </div>
          ) : (
            <div className="grid gap-6">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>General</CardTitle>
                  <CardDescription>
                    Your role: {ORG_ROLE_LABELS[organization.role]} —{' '}
                    {ORG_ROLE_DESCRIPTIONS[organization.role]}
                  </CardDescription>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-dashed">
                <CardHeader>
                  <CardTitle>Not built yet</CardTitle>
                  <CardDescription>
                    This organization is where the rest of the workspace will hang off.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <div className="flex items-start gap-3">
                    <BookOpenIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Courses</p>
                      <p className="text-xs text-muted-foreground">
                        Courses created inside this organization.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <UsersIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Members</p>
                      <p className="text-xs text-muted-foreground">
                        Invite teammates as {ORG_ROLE_LABELS.ADMIN}, {ORG_ROLE_LABELS.EDITOR}, or{' '}
                        {ORG_ROLE_LABELS.VIEWER}. You are currently its only member.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Role enforcement</p>
                      <p className="text-xs text-muted-foreground">
                        Memberships are recorded today, but nothing is gated on them yet.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
