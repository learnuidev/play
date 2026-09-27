'use client';

import { KeyRoundIcon } from 'lucide-react';
import { useOrganizationApiKeys, useRevokeOrganizationApiKey } from '@api/modules/api-key/api-key.queries';
import { Skeleton } from '@ui/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { ApiKeyRow } from './api-key-row';

/**
 * Every key made for one organization, for an admin of it.
 *
 * The page it sits on is the caller's own keys, and this is the other half of
 * the same question: a key belongs to the person who made it, and it can also
 * belong to an organization, where somebody other than that person has to be
 * able to see it and end it. A key outlives the integration it was made for and
 * often the employment too, and "who still has access?" is not answerable from
 * the maker's own account.
 */
export function OrganizationApiKeysCard({
  orgId,
  organizationName,
}: {
  orgId: string;
  organizationName: string;
}) {
  const keysQuery = useOrganizationApiKeys(orgId, true);
  const revoke = useRevokeOrganizationApiKey(orgId);

  const keys = keysQuery.data?.keys ?? [];

  return (
    <PageCard
      title={organizationName}
      description="Keys made for this organization, whoever made them. Admins can revoke any of them."
    >
      {keysQuery.isError ? (
        <p className="text-sm text-destructive">
          {keysQuery.error instanceof Error
            ? keysQuery.error.message
            : 'Failed to load these keys'}
        </p>
      ) : keysQuery.isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<KeyRoundIcon className="size-5 text-muted-foreground" />}
          title="No keys for this organization"
          description="Any member can make one for it. It appears here as soon as they do, so nothing is using this organization's courses without you knowing."
        />
      ) : (
        <div className="grid gap-3">
          {keys.map((key) => (
            <ApiKeyRow
              key={key.keyId}
              apiKey={key}
              showOwner
              revoking={revoke.isPending && revoke.variables === key.keyId}
              onRevoke={() => revoke.mutateAsync(key.keyId).then(() => undefined)}
            />
          ))}
          {keysQuery.data?.nextToken && (
            <p className="text-xs text-muted-foreground">
              Showing the hundred most recent keys.
            </p>
          )}
        </div>
      )}
    </PageCard>
  );
}
