'use client';

import Link from 'next/link';
import { ArrowRightIcon, BookOpenIcon, KeyRoundIcon, PlusIcon } from 'lucide-react';
import { useOAuthApps } from '@api/modules/oauth/oauth.queries';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { AppMark } from '@/components/oauth/app-mark';
import { CreateOAuthAppDialog } from '@/components/oauth/create-app-dialog';
import { ScopePills } from '@/components/oauth/scope-list';

/**
 * OAuth apps: the clients this account has registered.
 *
 * The other half of "call this API from your own code", and the one that exists
 * because a key is blunt in a way that matters: it acts as one person, forever,
 * with a reach chosen once at creation. An app instead asks *each person* for
 * permission, on a screen, in scopes they can read — and can be disconnected by
 * any of them without anybody rotating a credential.
 *
 * The list is the caller's own apps and nothing else: an app's settings, its
 * client secret and its registered redirect URIs are its author's business.
 * Connected apps — the other direction, where somebody else's app has been
 * authorized *by* this account — is a separate screen, because it is a separate
 * question and a different audience.
 */
export default function OAuthAppsPage() {
  const appsQuery = useOAuthApps();
  const apps = appsQuery.data?.apps ?? [];

  const createDialog = (trigger: React.ReactNode) => (
    <CreateOAuthAppDialog trigger={trigger} />
  );

  return (
    <div className="grid gap-6">
      <PageCard
        title="OAuth apps"
        description="Let other software act as your users, with their permission and nothing more."
        actions={
          apps.length > 0
            ? createDialog(
                <Button size="sm">
                  <PlusIcon />
                  Register app
                </Button>,
              )
            : undefined
        }
      >
        {appsQuery.isError ? (
          <p className="text-sm text-destructive">
            {appsQuery.error instanceof Error
              ? appsQuery.error.message
              : 'Failed to load your apps'}
          </p>
        ) : appsQuery.isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : apps.length === 0 ? (
          <EmptyState
            icon={<KeyRoundIcon className="size-5 text-muted-foreground" />}
            title="No apps yet"
            description="Register one and it can send people here to sign in and grant permission. It gets a client id, a redirect URI you control, and only the scopes you choose."
            action={createDialog(
              <Button>
                <PlusIcon />
                Register app
              </Button>,
            )}
          />
        ) : (
          <div className="grid gap-3">
            {apps.map((app) => (
              <Link
                key={app.appId}
                href={`/oauth/apps/${app.appId}`}
                className="flex items-start gap-4 rounded-2xl border border-border/60 bg-card px-4 py-4 transition-colors hover:bg-muted/40"
              >
                <AppMark name={app.name} logoUrl={app.logoUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{app.name}</p>
                    <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
                      {app.isPublic ? 'Public client' : 'Confidential'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {app.description}
                  </p>
                  <div className="mt-2.5">
                    <ScopePills scopes={app.scopes} />
                  </div>
                  <p className="mt-2.5 font-mono text-xs text-muted-foreground">
                    {app.clientId}
                  </p>
                </div>
                <ArrowRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </PageCard>

      {/* The reference sits with the apps for the reason it sits with the keys:
          the moment somebody needs it is the moment they have just made one. */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border/60 bg-card px-6 py-5 text-card-foreground shadow-sm">
        <div className="min-w-0">
          <p className="text-base font-semibold tracking-tight">How the flow works</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The authorization URL, PKCE, exchanging the code, refreshing, revoking, and every
            scope — written out end to end.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/docs#oauth">
            Read the API reference
            <BookOpenIcon />
          </Link>
        </Button>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border/60 bg-card px-6 py-5 text-card-foreground shadow-sm">
        <div className="min-w-0">
          <p className="text-base font-semibold tracking-tight">Not building an app?</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            A script that just needs to read the API can use a key — one header, no redirect, no
            consent screen.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/api-keys">
            Go to API keys
            <ArrowRightIcon />
          </Link>
        </Button>
      </section>
    </div>
  );
}
