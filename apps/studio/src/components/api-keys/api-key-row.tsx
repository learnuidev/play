'use client';

import { useState } from 'react';
import { KeyRoundIcon, Loader2Icon, ShieldOffIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiKey, OrganizationApiKey } from '@play/types';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/components/ui/dialog';

/** `Mar 4, 2026`, the same date the rest of the app prints. */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * When a key was last used, said the way a person would say it.
 *
 * Relative rather than absolute for the recent past, because the question this
 * answers is "is anything still using this key?" — a date three days ago and a
 * date three months ago are the same sentence otherwise. A key that has never
 * been used says so, which is its own answer and the common one for a key made
 * and not yet wired up.
 */
function lastUsedLabel(lastUsedAt: number | undefined): string {
  if (!lastUsedAt) return 'Never used';

  const elapsedMs = Date.now() - lastUsedAt;
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 1) return 'Used just now';
  if (minutes < 60) return `Used ${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Used ${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `Used ${days} day${days === 1 ? '' : 's'} ago`;

  return `Used ${formatDate(lastUsedAt)}`;
}

/**
 * Asks before a key stops working.
 *
 * A confirmation rather than an undo, because there is nothing to undo: the
 * secret is unrecoverable, so revoking means every integration holding it has to
 * be given a new one by hand. That is worth one dialog.
 *
 * The dialog closes only when the revocation actually happened. A failure is
 * reported here and the dialog stays open, on the grounds that the alternative —
 * closing on a revoke that failed — is the one outcome where the reader believes
 * something is off when it is still live.
 */
function RevokeKeyDialog({
  keyName,
  onConfirm,
  pending,
}: {
  keyName: string;
  onConfirm: () => Promise<void>;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);

  async function confirm() {
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke the key');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <ShieldOffIcon />
        Revoke
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke “{keyName}”?</DialogTitle>
          <DialogDescription>
            Anything using this key stops working immediately, and the secret cannot be recovered.
            Make a new key and give it to whatever was using this one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Keep it
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Revoke key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One key: what it is called, enough of it to recognize, and how to cut it off.
 *
 * A key made for an organization says so, in the same row as its name, because
 * that is what decides what it can reach.
 *
 * There is no revoked state to draw, because revoking deletes the key: the row
 * leaves the cache, the row leaves the table, and there is nothing left that
 * could be shown as revoked.
 */
export function ApiKeyRow({
  apiKey,
  onRevoke,
  revoking,
  showOwner = false,
}: {
  apiKey: ApiKey | OrganizationApiKey;
  onRevoke: () => Promise<void>;
  revoking: boolean;
  /** Admin lists print who made the key; your own list has only one answer. */
  showOwner?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border px-4 py-3.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        <KeyRoundIcon className="size-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{apiKey.name}</p>
          {apiKey.organizationName && <Badge variant="secondary">{apiKey.organizationName}</Badge>}
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {/* The prefix and ellipsis together, so nobody reads it as the key. */}
          <span className="font-mono">{apiKey.prefix}…</span>
          <span aria-hidden>·</span>
          <span>{lastUsedLabel(apiKey.lastUsedAt)}</span>
          <span aria-hidden>·</span>
          <span>Made {formatDate(apiKey.createdAt)}</span>
        </p>

        {showOwner && 'userId' in apiKey && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Made by {apiKey.userEmail ?? apiKey.userId}
          </p>
        )}
      </div>

      <div className="shrink-0">
        <RevokeKeyDialog
          keyName={apiKey.name}
          pending={revoking}
          onConfirm={async () => {
            // Throws on failure, which the dialog reports and stays open on.
            // The success toast is here rather than there because the key's
            // name is.
            await onRevoke();
            toast.success(`“${apiKey.name}” revoked`, {
              description: 'Anything using it has stopped working.',
            });
          }}
        />
      </div>
    </div>
  );
}
