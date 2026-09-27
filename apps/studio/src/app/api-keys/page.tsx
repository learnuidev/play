'use client';

import Link from 'next/link';
import { ArrowRightIcon, KeyRoundIcon, PlusIcon } from 'lucide-react';
import { useApiKeys, useRevokeApiKey } from '@api/modules/api-key/api-key.queries';
import { useOrganizations } from '@api/modules/organization/organization.queries';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { ApiKeyRow } from '@/components/api-keys/api-key-row';
import { CreateApiKeyDialog } from '@/components/api-keys/create-api-key-dialog';
import { OrganizationApiKeysCard } from '@/components/api-keys/organization-api-keys-card';

/**
 * API keys: what the caller hands to their own code so it can call this API.
 *
 * Two lists on one page, because they are two halves of one question. The first
 * is the caller's own keys — the ones they made, which act as them, and which
 * only they can cut off. The second, for each organization they administer, is
 * every key made for that organization, whoever made it: the ones somebody else
 * has to be able to end.
 *
 * The keys themselves are the point rather than something linked from a
 * settings page: making one is a two-field dialog, and the secret is shown once
 * and never again, so the screen that makes keys and the screen that lists them
 * have to be the same screen.
 */
export default function ApiKeysPage() {
  const keysQuery = useApiKeys();
  const organizationsQuery = useOrganizations();
  const revoke = useRevokeApiKey();

  const keys = keysQuery.data?.keys ?? [];

  // Only an admin sees the organization's keys, and the API enforces it — this
  // is what decides whether to ask at all, not what decides the answer.
  const memberships = organizationsQuery.data?.organizations ?? [];
  const scopes = memberships.map((organization) => ({
    orgId: organization.orgId,
    name: organization.name,
  }));
  const adminOf = memberships.filter((organization) => organization.role === 'ADMIN');

  const createDialog = (trigger: React.ReactNode) => (
    <CreateApiKeyDialog organizations={scopes} trigger={trigger} />
  );

  return (
    <div className="grid gap-6">
      <PageCard
        title="API keys"
        description="Call the Play API from your own code. One header, no sign-in, read-only."
        actions={
          keys.length > 0
            ? createDialog(
                <Button size="sm">
                  <PlusIcon />
                  Create key
                </Button>,
              )
            : undefined
        }
      >
        {keysQuery.isError ? (
          <p className="text-sm text-destructive">
            {keysQuery.error instanceof Error ? keysQuery.error.message : 'Failed to load your keys'}
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
            title="No keys yet"
            description="Make one and give it to whatever needs to read your courses — a reporting script, a partner's backend, a nightly export."
            action={createDialog(
              <Button>
                <PlusIcon />
                Create key
              </Button>,
            )}
          />
        ) : (
          <div className="grid gap-3">
            {keys.map((key) => (
              <ApiKeyRow
                key={key.keyId}
                apiKey={key}
                revoking={revoke.isPending && revoke.variables === key.keyId}
                onRevoke={() => revoke.mutateAsync(key.keyId).then(() => undefined)}
              />
            ))}
            {keysQuery.data?.nextToken && (
              <p className="text-xs text-muted-foreground">
                Showing your hundred most recent keys. Revoke the ones you have finished with to see
                the rest.
              </p>
            )}
          </div>
        )}
      </PageCard>

      {/* The reference sits with the keys rather than in the header, because the
          moment somebody needs it is the moment they have just made one. */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border/60 bg-card px-6 py-5 text-card-foreground shadow-sm">
        <div className="min-w-0">
          <p className="text-base font-semibold tracking-tight">What can a key do?</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Every endpoint, its parameters, and the exact body and response of each one.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/docs">
            Read the API reference
            <ArrowRightIcon />
          </Link>
        </Button>
      </section>

      {adminOf.map((organization) => (
        <OrganizationApiKeysCard
          key={organization.orgId}
          orgId={organization.orgId}
          organizationName={organization.name}
        />
      ))}
    </div>
  );
}
