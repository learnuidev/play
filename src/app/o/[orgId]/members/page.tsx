'use client';

import { useParams } from 'next/navigation';
import { UsersIcon } from 'lucide-react';
import { ORG_ROLES, ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS } from '@/types';
import { useOrganization } from '@/modules/organization/organization.queries';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageCard } from '@/components/shell/page-card';

const ROLE_VARIANT = {
  ADMIN: 'default',
  EDITOR: 'secondary',
  VIEWER: 'outline',
} as const;

export default function OrganizationMembersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data, isLoading } = useOrganization(orgId);
  const organization = data?.organization;

  return (
    <div className="grid gap-6">
      <PageCard
        title="Members"
        description="Who can see and change what this organization owns."
      >
        {isLoading || !organization ? (
          <Skeleton className="h-14 w-full rounded-xl" />
        ) : (
          <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
            <div className="flex size-9 items-center justify-center rounded-full border bg-muted/40">
              <UsersIcon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">You</p>
              <p className="text-xs text-muted-foreground">
                The only member — invitations are not built yet.
              </p>
            </div>
            <Badge variant={ROLE_VARIANT[organization.role]}>
              {ORG_ROLE_LABELS[organization.role]}
            </Badge>
          </div>
        )}
      </PageCard>

      <PageCard
        title="Roles"
        description="Roles already gate video access, even though nobody can be invited yet."
      >
        <dl className="grid gap-3">
          {ORG_ROLES.map((role) => (
            <div key={role} className="flex items-start gap-3 rounded-xl border px-4 py-3">
              <Badge variant={ROLE_VARIANT[role]} className="mt-0.5 shrink-0">
                {ORG_ROLE_LABELS[role]}
              </Badge>
              <dd className="text-xs text-muted-foreground">{ORG_ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </PageCard>
    </div>
  );
}
