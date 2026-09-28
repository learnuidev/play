'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2Icon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { useDeleteOAuthApp } from '@api/modules/oauth/oauth.queries';
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

/**
 * Deletes an app, after saying who it affects.
 *
 * The consequence people do not expect is the second one: deleting an app does
 * not merely stop it signing anybody in — it ends every authorization it has
 * ever been given and deletes every token those produced, so everybody who
 * connected it is disconnected and whoever is running the app sees it fail on
 * its next call. That is the right behaviour (an app that no longer exists must
 * not leave working credentials behind) and it is worth one sentence before the
 * button, because it is not something that can be undone.
 */
export function DeleteAppDialog({
  appId,
  appName,
  trigger,
}: {
  appId: string;
  appName: string;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const remove = useDeleteOAuthApp();

  async function confirm() {
    try {
      await remove.mutateAsync(appId);
      setOpen(false);
      router.push('/oauth/apps');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the app');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {appName}?</DialogTitle>
          <DialogDescription>
            The client id stops working, everyone who connected the app is disconnected, and every
            token it was holding is deleted. There is no undo — a new app is a new client, with a
            new client id and a new consent screen.
          </DialogDescription>
        </DialogHeader>

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
            disabled={remove.isPending}
          >
            {remove.isPending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
            Delete app
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
