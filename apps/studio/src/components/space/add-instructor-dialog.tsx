'use client';

import { useState, type ReactNode } from 'react';
import { Loader2Icon, UserPlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useSpaceMemberCandidates, useUpdateSpaceMember } from '@api/modules/space-member/space-member.queries';
import { PersonAvatar } from '@play/ui';
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
import { cn } from '@ui/lib/utils';
import { spaceMemberEmail, spaceMemberName } from '@/lib/space-member';

/**
 * Putting somebody on a course's staff list.
 *
 * Picking from the people already in the course, because that is what the
 * assignment *is*: an instructor is a member with a different role, and the role
 * is what a course page credits. Creating the membership and giving it the role
 * in one request would be a second way to do the thing the Members tab already
 * does, and the two would drift.
 *
 * So somebody who is not in the course yet is not on this list — they are
 * invited, by email, with the same dialog the roster uses. That path is one
 * button away in the panel this dialog opens from, and it is the honest one: an
 * invitation is addressed to an address, and a person who has no account yet has
 * no id to pick.
 */
export function AddInstructorDialog({
  spaceId,
  trigger,
}: {
  spaceId: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const membersQuery = useSpaceMemberCandidates(spaceId, open);
  const update = useUpdateSpaceMember(spaceId);

  // Everyone who could teach it and does not already: an outstanding invitation
  // is not one of them, because the role it carries is not in force until
  // somebody claims it, and an invitation's role is corrected by re-sending it.
  // Your own row comes first — crediting a course to yourself is the ordinary
  // case, and it should not be a row to hunt for.
  const candidates = (membersQuery.data?.members ?? [])
    .filter((member) => !member.pending && member.role !== 'INSTRUCTOR')
    .sort((a, b) => Number(b.isYou) - Number(a.isYou));

  const chosen = candidates.find((member) => member.userId === selected);

  async function submit() {
    if (!chosen) return;

    try {
      await update.mutateAsync({ memberId: chosen.userId, role: 'INSTRUCTOR' });
      toast.success(`${chosen.name ?? chosen.email ?? 'They'} now teach this course`);
      setOpen(false);
      setSelected(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add them as an instructor');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelected(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who teaches this course</DialogTitle>
          <DialogDescription>
            Pick somebody who is already in it. They are credited on the course&rsquo;s
            marketplace page, under their own name and photo.
          </DialogDescription>
        </DialogHeader>

        {membersQuery.isLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
            Everyone in this course already teaches it. Somebody new is invited by email — use
            &ldquo;Invite an instructor&rdquo; beside this button, and they join with the role.
          </p>
        ) : (
          <div className="grid max-h-80 gap-1 overflow-y-auto">
            {candidates.map((member) => {
              const name = spaceMemberName(member);
              const email = spaceMemberEmail(member);
              const isChosen = member.userId === selected;

              return (
                <button
                  key={member.userId}
                  type="button"
                  onClick={() => setSelected(isChosen ? null : member.userId)}
                  aria-pressed={isChosen}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                    isChosen ? 'border-ring bg-muted/50' : 'hover:bg-muted/40',
                  )}
                >
                  <PersonAvatar name={name} photoUrl={member.photoUrl} size="md" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{name}</span>
                      {email && (
                        <span className="truncate text-xs text-muted-foreground" title={email}>
                          {email}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {member.isYou ? 'This is you.' : `Joined ${new Date(member.joinedAt).toLocaleDateString()}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" disabled={!chosen || update.isPending} onClick={() => void submit()}>
            {update.isPending ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />}
            Add as instructor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
