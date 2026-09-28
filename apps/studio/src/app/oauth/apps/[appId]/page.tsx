'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftIcon, InfoIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { useOAuthApp } from '@api/modules/oauth/oauth.queries';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { BlockLabel, EmptyState, PageCard } from '@/components/shell/page-card';
import { AppMark } from '@/components/oauth/app-mark';
import { AppSettingsForm } from '@/components/oauth/app-settings-form';
import { DeleteAppDialog } from '@/components/oauth/delete-app-dialog';
import { RotateSecretDialog } from '@/components/oauth/rotate-secret-dialog';
import { CopyButton } from '@/components/copy-button';
import { authorizationUrlFor } from '@/lib/oauth-authorize';

/** `Mar 4, 2026`, the date the rest of the app prints. */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * One app: what it is, what it may ask for, and the two credentials it holds.
 *
 * Ordered the way an app is actually built. First what the consent screen will
 * say — name, sentence, mark, homepage — because that is the part somebody
 * writing an integration cannot test locally. Then where it is sent back to, and
 * what it may ask for. Then the credentials, which are read once and then live in
 * the app's own configuration. Then, at the bottom and behind its own
 * confirmation, the two things that end an app: rotating what it authenticates
 * with, and deleting it.
 */
export default function OAuthAppPage() {
  const params = useParams<{ appId: string }>();
  const appId = typeof params?.appId === 'string' ? params.appId : '';

  const appQuery = useOAuthApp(appId);
  const app = appQuery.data?.app;
  const [origin, setOrigin] = useState('');

  // The authorization URL is an example for the app's author to paste into their
  // client, so it needs this deployment's origin — which is only knowable in the
  // browser, since the studio is reachable at more than one host name.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const authorizeExample = useMemo(
    () =>
      app && origin && app.redirectUris[0]
        ? authorizationUrlFor(origin, app.clientId, app.redirectUris[0])
        : '',
    [app, origin],
  );

  if (appQuery.isError) {
    return (
      <PageCard title="OAuth app" description="This app could not be read.">
        <EmptyState
          icon={<InfoIcon className="size-5 text-muted-foreground" />}
          title="Not found"
          description="An app that does not exist, or one registered by somebody else, answers the same way — which app ids exist is not a stranger's business."
          action={
            <Button asChild variant="secondary">
              <Link href="/oauth/apps">
                <ArrowLeftIcon />
                Back to your apps
              </Link>
            </Button>
          }
        />
      </PageCard>
    );
  }

  if (!app) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-24 w-full rounded-3xl" />
        <Skeleton className="h-96 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageCard
        title={app.name}
        description={app.description}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/oauth/apps">
              <ArrowLeftIcon />
              All apps
            </Link>
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          <AppMark name={app.name} logoUrl={app.logoUrl} size="md" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {app.isPublic
                ? 'Public client — no secret, PKCE only'
                : 'Confidential client — authenticates with a secret'}
              {' · registered '}
              {formatDate(app.createdAt)}
            </p>
            {app.homepageUrl && (
              <a
                href={app.homepageUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 block truncate text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {app.homepageUrl}
              </a>
            )}
          </div>
        </div>
      </PageCard>

      <PageCard title="Settings" description="What the consent screen says, and what the app may ask for.">
        <AppSettingsForm app={app} />
      </PageCard>

      <PageCard
        title="Credentials"
        description="What your app authenticates with. Both are safe to keep in a server's environment."
      >
        <div className="grid gap-5">
          <div className="grid gap-2">
            <span className="text-sm font-medium">Client id</span>
            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{app.clientId}</code>
              <CopyButton value={app.clientId} label="Copy" variant="secondary" />
            </div>
            <p className="text-xs text-muted-foreground">
              Public. It travels in the authorization URL a browser can read, and in every token
              request.
            </p>
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium">Client secret</span>
            {app.isPublic ? (
              <p className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                This app has no secret. It proves itself with PKCE, which is what a browser, a
                desktop app or a CLI can actually do.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <code className="rounded-xl border bg-muted/40 px-3 py-2 font-mono text-xs">
                    {app.clientSecretPrefix ? `${app.clientSecretPrefix}…` : 'not on record'}
                  </code>
                  <RotateSecretDialog
                    appId={app.appId}
                    appName={app.name}
                    trigger={
                      <Button type="button" variant="secondary" size="sm">
                        <RefreshCwIcon />
                        Rotate
                      </Button>
                    }
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Only the beginning is kept in the clear — the secret itself is stored as a hash
                  and cannot be shown again. Rotating it replaces it, and your app has to be
                  redeployed with the new value.
                </p>
              </>
            )}
          </div>

          {authorizeExample && (
            <div className="grid gap-2">
              <BlockLabel>Where to send people</BlockLabel>
              <div className="flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{authorizeExample}</code>
                <CopyButton value={authorizeExample} label="Copy" variant="secondary" />
              </div>
              <p className="text-xs text-muted-foreground">
                Built from your client id and your first redirect URI. Your client replaces{' '}
                <span className="font-mono">code_challenge</span> with one derived from its own
                verifier, and may add <span className="font-mono">scope</span> and{' '}
                <span className="font-mono">state</span>. The full walkthrough is in the{' '}
                <Link href="/docs#oauth" className="underline underline-offset-4">
                  API reference
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      </PageCard>

      <PageCard
        title="Danger zone"
        description="Deleting an app cannot be undone, and it disconnects everyone using it."
      >
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-destructive/40 bg-destructive/5 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Delete this app</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Everybody who connected it is disconnected and every token it holds is deleted.
            </p>
          </div>
          <DeleteAppDialog
            appId={app.appId}
            appName={app.name}
            trigger={
              <Button type="button" variant="destructive" size="sm">
                <Trash2Icon />
                Delete app
              </Button>
            }
          />
        </div>
      </PageCard>
    </div>
  );
}
