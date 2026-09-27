'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { useSpaceMembers } from '@api/modules/space-member/space-member.queries';
import { useAddCohortMember, useRemoveCohortMember } from '@api/modules/cohort/cohort.queries';
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
  DialogTrigger,
} from '@ui/components/ui/dialog';
import { Skeleton } from '@ui/components/ui/skeleton';
import { SPACE_MEMBER_ROLE_LABELS, type CohortWithMembers, type SpaceMemberApi } from '@play/types';

/** How a roster row is named here: an address if there is one, its key if not. */
function displayName(member: SpaceMemberApi): string {
  if (member.isYou) return 'You';
  if (member.email) return member.email;
  return `Member ${member.userId.slice(0, 6)}`;
}

/**
 * Puts members of the course into one cohort, and takes them out again.
 *
 * Membership is many-to-many on purpose: a person may be in a September intake
 * *and* in a tutorial group, so this writes the difference between what was
 * ticked and what the cohort already held rather than replacing the cohort's
 * members with the tick boxes.
 *
 * Only members who have joined can be ticked. An outstanding invitation is a
 * name attached to an address that nobody has signed in as yet, so it is shown
 * greyed out and disabled instead of silently becoming a membership the moment
 * it is accepted.
 */
export function CohortMembersDialog({
  spaceId,
  cohort,
  trigger,
}: {
  spaceId: string;
  cohort: CohortWithMembers;
  trigger: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(cohort.memberIds);

  const membersQuery = useSpaceMembers(spaceId);
  const add = useAddCohortMember(spaceId);
  const remove = useRemoveCohortMember(spaceId);
  const pending = add.isPending || remove.isPending;

  const members = membersQuery.data?.members ?? [];
  // Members who have joined first: they are the only rows that can be acted on,
  // so the invitations that cannot be ticked sit below them rather than mixed in.
  const roster = [...members].sort((a, b) => Number(a.pending) - Number(b.pending));
  const ticked = new Set(selected);

  // What the cohort held when the dialog opened, narrowed to the rows on show.
  // Somebody who has left the course keeps their old membership row server-side,
  // and is not something this list can put a tick against either way.
  const joinedIds = roster.filter((member) => !member.pending).map((member) => member.userId);
  const wasInCohort = cohort.memberIds.filter((memberId) => joinedIds.includes(memberId));
  const added = joinedIds.filter((memberId) => ticked.has(memberId) && !wasInCohort.includes(memberId));
  const removed = wasInCohort.filter((memberId) => !ticked.has(memberId));
  const changed = added.length > 0 || removed.length > 0;
  const canSubmit = changed && !pending;

  useEffect(() => {
    if (!open) return;
    setSelected(cohort.memberIds);
  }, [open, cohort]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSelected(cohort.memberIds);
  }

  function toggle(memberId: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, memberId] : current.filter((id) => id !== memberId),
    );
  }

  /** The single toast that closes the dialog: only the sides that did something. */
  function describeChange(): string {
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} added`);
    if (removed.length > 0) parts.push(`${removed.length} removed`);
    return parts.join(', ');
  }

  async function submit() {
    if (!canSubmit) return;

    try {
      // One call at a time: each of these returns the cohort as it now stands,
      // and fired together they would race over the same list of members.
      for (const memberId of added) {
        await add.mutateAsync({ cohortId: cohort.cohortId, memberId });
      }
      for (const memberId of removed) {
        await remove.mutateAsync({ cohortId: cohort.cohortId, memberId });
      }
      toast.success(describeChange(), { description: `In ${cohort.name}` });
      setOpen(false);
      setSelected(cohort.memberIds);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not change who is in this cohort',
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{cohort.name}</DialogTitle>
          <DialogDescription>
            Tick the members of this course who belong to this cohort. A member can be in more than
            one cohort, and this only changes this one.
          </DialogDescription>
        </DialogHeader>

        {membersQuery.isError ? (
          <div className="rounded-3xl border border-dashed border-border/70 px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {membersQuery.error instanceof Error
                ? membersQuery.error.message
                : 'The roster could not be read.'}
            </p>
          </div>
        ) : membersQuery.isLoading ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : roster.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/70 px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nobody has joined this course yet, so there is nobody to put in a cohort.
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {roster.map((member) => {
              const checked = ticked.has(member.userId);
              return (
                <label
                  key={member.userId}
                  htmlFor={`cohort-member-${member.userId}`}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                    member.pending
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer hover:bg-muted/40',
                  )}
                >
                  <input
                    id={`cohort-member-${member.userId}`}
                    type="checkbox"
                    checked={checked}
                    disabled={member.pending}
                    onChange={(event) => toggle(member.userId, event.target.checked)}
                    className="size-4 shrink-0 accent-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {displayName(member)}
                    </span>
                    {member.pending && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Invited — not joined yet
                      </span>
                    )}
                  </span>
                  <Badge
                    variant={member.role === 'STUDENT' ? 'outline' : 'secondary'}
                    className="shrink-0"
                  >
                    {SPACE_MEMBER_ROLE_LABELS[member.role]}
                  </Badge>
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {/* Closing mid-flight would leave the sequential writes running with
              nowhere to report themselves, so Cancel waits for them too. */}
          <DialogClose asChild>
            <Button variant="ghost" type="button" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
            {pending && <Loader2Icon className="animate-spin" />}
            {changed ? describeChange() : 'Save members'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
