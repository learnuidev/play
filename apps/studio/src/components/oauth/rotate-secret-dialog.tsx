'use client';

import { useState } from 'react';
import { Loader2Icon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useRotateOAuthAppSecret } from '@api/modules/oauth/oauth.queries';
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
import { CopyButton } from '@/components/copy-button';

/**
 * Replaces a client secret, and shows the new one the one time it exists.
 *
 * Rotating is a credential cut-over, not a setting: the moment it succeeds the
 * app's old secret stops working, which means the app's own deployment has to be
 * updated with the new value or it stops authenticating. So it is confirmed, and
 * the confirmation says what happens rather than asking "are you sure" — the
 * question somebody actually has is "will this break my app", and the answer is
 * "until you redeploy it, yes".
 *
 * A failure is reported and the dialog stays open; a success turns it into the
 * reveal, because the secret is unrecoverable and a dialog that closed on one
 * would close on a credential nobody has.
 */
export function RotateSecretDialog({
  appId,
  appName,
  trigger,
}: {
  appId: string;
  appName: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const rotate = useRotateOAuthAppSecret(appId);

  async function confirm() {
    try {
      const response = await rotate.mutateAsync();
      setSecret(response.secret);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not rotate the secret');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) close();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy the new secret now</DialogTitle>
              <DialogDescription>
                It is shown once. Your app is not authenticating until it is redeployed with this
                value — the old secret stopped working the moment you confirmed.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{secret}</code>
              <CopyButton value={secret} label="Copy" variant="secondary" />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Rotate {appName}&apos;s client secret?</DialogTitle>
              <DialogDescription>
                The current secret stops working immediately, and every deployment using it starts
                being refused. You will be shown the new one once.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p className="text-xs text-muted-foreground">
                People who have already connected the app are not affected: their authorizations and
                tokens are theirs, and a client secret is only what the app authenticates *itself*
                with.
              </p>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="button" onClick={() => void confirm()} disabled={rotate.isPending}>
                {rotate.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                Rotate secret
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
