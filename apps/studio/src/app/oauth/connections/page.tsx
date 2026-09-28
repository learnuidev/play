'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KeyRoundIcon, Link2OffIcon, Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteOAuthConnection, useOAuthConnections } from '@api/modules/oauth/oauth.queries';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ui/components/ui/dialog';
import { Skeleton } from '@ui/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { AppMark } from '@/components/oauth/app-mark';
import { ScopePills } from '@/components/oauth/scope-list';

/** `Mar 4`, the day somebody connected an app. */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * When an app was last used, said the way a person would say it.
 *
 * The question this answers is "is this still doing anything?", which is the
 * question somebody asks immediately before disconnecting something. Relative
 * for the recent past for that reason, and "Never used" is its own answer: an app
 * that was authorized and never called anything is the easiest one to disconnect.
 *
 * Accurate to about five minutes, because recording it is a write and this
 * service does not put a write in front of every call a customer makes.
 */
function lastUsedLabel(lastUsedAt: number | undefined): string {
  if (!lastUsedAt) return 'Never used';

  const minutes = Math.round((Date.now() - lastUsedAt) / 60_000);
  if (minutes < 1) return 'Used just now';
  if (minutes < 60) return `Used ${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Used ${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `Used ${days} day${days === 1 ? '' : 's'} ago`;

  return `Used ${formatDate(lastUsedAt)}`;
}

/**
 * Every app this account has authorized, and what each one may do.
 *
 * The sentence at the top of each row is the scope somebody agreed to, written
 * the way the consent screen wrote it — not the scope id. A list that said
 * `lessons:stream` would be a list only its author could read, which defeats the
 * point of showing it to the person who granted it.
 *
 * Disconnecting is immediate and total: the app's tokens are deleted, so it
 * stops being able to call the API on its next request rather than within the
 * hour its access token would have lasted. That is why it is confirmed, and why
 * the confirmation says the app is not told.
 */
export default function OAuthConnectionsPage() {
  const connectionsQuery = useOAuthConnections();
  const connections = connectionsQuery.data?.connections ?? [];

  return (
    <div className="grid gap-6">
      <PageCard
        title="Connected apps"
        description="Apps you have given permission to act on your behalf. Disconnecting one stops it at once."
      >
        {connectionsQuery.isError ? (
          <p className="text-sm text-destructive">
            {connectionsQuery.error instanceof Error
              ? connectionsQuery.error.message
              : 'Failed to load your connections'}
          </p>
        ) : connectionsQuery.isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : connections.length === 0 ? (
          <EmptyState
            icon={<KeyRoundIcon className="size-5 text-muted-foreground" />}
            title="Nothing is connected"
            description="When an app asks to act on your behalf, it appears here with exactly what you allowed — and this is where you take it back."
            action={
              <Button asChild variant="secondary">
                <Link href="/oauth/apps">Register an app instead</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3">
            {connections.map((connection) => (
              <div
                key={connection.appId}
                className="flex flex-wrap items-start gap-4 rounded-2xl border border-border/60 bg-card px-4 py-4"
              >
                <AppMark name={connection.name} logoUrl={connection.logoUrl} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-sm font-medium">{connection.name}</p>
                    {connection.homepageUrl && (
                      <a
                        href={connection.homepageUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                      >
                        {connection.homepageUrl}
                      </a>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{connection.description}</p>

                  <div className="mt-2.5">
                    <ScopePills scopes={connection.scopes} />
                  </div>

                  <p className="mt-2.5 text-xs text-muted-foreground">
                    Connected {formatDate(connection.createdAt)} · {lastUsedLabel(connection.lastUsedAt)}
                  </p>
                </div>

                <DisconnectDialog appId={connection.appId} appName={connection.name} />
              </div>
            ))}
          </div>
        )}
      </PageCard>
    </div>
  );
}

/**
 * Disconnects an app, after saying what the app will see.
 *
 * An app is not told when somebody disconnects it — there is no webhook, so that
 * this service never makes an outbound request to a URL a client chose — and the
 * only way it finds out is by being refused on its next call. Somebody cutting an
 * app off deserves to know that is what happens, so that a support question
 * about "the integration suddenly stopped working" has an answer.
 */
function DisconnectDialog({ appId, appName }: { appId: string; appName: string }) {
  const [open, setOpen] = useState(false);
  const disconnect = useDeleteOAuthConnection();

  async function confirm() {
    try {
      await disconnect.mutateAsync(appId);
      toast.success(`${appName} was disconnected`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not disconnect the app');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <Link2OffIcon />
          Disconnect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {appName}?</DialogTitle>
          <DialogDescription>
            Every credential it holds for your account is deleted, so it stops working on its next
            call rather than within the hour. It is not notified — the next request it makes is
            refused, and its author sees that.
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Nothing else is affected: your account, your courses and everything you have written stay
          exactly as they are.
        </p>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void confirm()}
            disabled={disconnect.isPending}
          >
            {disconnect.isPending ? <Loader2Icon className="animate-spin" /> : <Link2OffIcon />}
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
