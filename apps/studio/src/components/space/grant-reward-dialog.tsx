'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Loader2Icon, SearchIcon, UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  SPACE_MEMBER_ROLE_LABELS,
  type SpaceMemberApi,
  type SpaceReward,
} from '@/types';
import { useGrantReward } from '@/modules/reward/reward.queries';
import { useSpaceMembers } from '@/modules/space-member/space-member.queries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

/** The API's ceiling on the note, mirroring it so the field cannot overrun it. */
const MAX_NOTE_LENGTH = 500;

/**
 * Who a member is, in words: their address where the page has one, otherwise the
 * short tail of the id, which is enough to tell two people apart on one screen
 * without pretending to be a name.
 */
function memberLabel(member: SpaceMemberApi): string {
  if (member.isYou) return 'You';
  if (member.email) return member.email;
  return `Member ${member.userId.slice(0, 6)}`;
}

/**
 * Hands one reward to one member.
 *
 * The other way a grant happens is a milestone, which nobody decides. This is for
 * everything a milestone cannot see: the discount an instructor promised, the
 * gift card sent to somebody who answered a question well. It is therefore
 * deliberately not restricted to people who have earned it.
 *
 * Only members are offered — an outstanding invitation is not a membership yet,
 * and the API refuses a grant to somebody who has not joined.
 */
export function GrantRewardDialog({
  spaceId,
  reward,
  trigger,
}: {
  spaceId: string;
  reward: SpaceReward;
  trigger: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [memberId, setMemberId] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');

  const membersQuery = useSpaceMembers(spaceId);
  const grantReward = useGrantReward(spaceId);

  const members = (membersQuery.data?.members ?? []).filter((member) => !member.pending);
  const query = search.trim().toLowerCase();
  const shown =
    query.length === 0
      ? members
      : members.filter(
          (member) =>
            (member.email ?? '').toLowerCase().includes(query) ||
            member.userId.toLowerCase().includes(query),
        );

  const selected = members.find((member) => member.userId === memberId);
  // A custom reward carries no code — there is nothing to redeem, since it is
  // handed over by a person — so it is not offered a field for one.
  const carriesCode = reward.kind !== 'CUSTOM';
  const canSubmit = Boolean(selected) && !grantReward.isPending;

  function reset() {
    setSearch('');
    setMemberId('');
    setCode('');
    setNote('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !canSubmit) return;

    try {
      const { grant, created } = await grantReward.mutateAsync({
        rewardId: reward.rewardId,
        userId: selected.userId,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(carriesCode && code.trim() ? { code: code.trim() } : {}),
      });

      const who = memberLabel(selected);
      // One grant per person per reward is what the table is keyed by, so
      // granting to somebody who already holds it hands back the one they have
      // rather than issuing a second. Saying "granted" there would be a claim the
      // reward cannot back up.
      if (created) {
        toast.success(`Reward granted to ${who}`, {
          description: grant.code ? `Their code is ${grant.code}` : reward.instructions,
        });
      } else {
        toast.info(`${who} already held this reward`, {
          description: grant.code
            ? `Their code from before is ${grant.code}`
            : 'Nothing new was issued.',
        });
      }

      setOpen(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not grant the reward');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant “{reward.name}”</DialogTitle>
          <DialogDescription>
            Hand it to one member by hand. They do not have to have reached the milestone — this is
            the route for everything a milestone cannot see.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="reward-grant-search">Who it goes to</Label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="reward-grant-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by email address or member id"
                autoComplete="off"
                className="pl-9"
                autoFocus
              />
            </div>
          </div>

          {membersQuery.isError ? (
            <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {membersQuery.error instanceof Error
                  ? membersQuery.error.message
                  : 'The roster could not be read.'}
              </p>
            </div>
          ) : membersQuery.isLoading ? (
            <div className="grid gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full border bg-muted/40">
                <UsersIcon className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Nobody has joined this course yet, so there is nobody to grant it to. Grant to
                somebody once they have accepted an invitation — an invitation that has not been
                accepted is not a member.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Nobody in this course matches “{search.trim()}”.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <div className="grid gap-2 p-2">
                {shown.map((member) => {
                  const isSelected = memberId === member.userId;
                  return (
                    <label
                      key={member.userId}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
                        isSelected ? 'border-ring bg-muted/50' : 'hover:bg-muted/40',
                      )}
                    >
                      <input
                        type="radio"
                        name="reward-grant-member"
                        value={member.userId}
                        checked={isSelected}
                        onChange={() => setMemberId(member.userId)}
                        className="mt-0.5 size-4 shrink-0 accent-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {memberLabel(member)}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {SPACE_MEMBER_ROLE_LABELS[member.role]}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {carriesCode && (
            <div className="grid gap-2">
              <Label htmlFor="reward-grant-code">Code</Label>
              <Input
                id="reward-grant-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Leave empty to generate one"
                autoComplete="off"
                className="font-mono uppercase"
              />
              {/* A code per grant rather than one code per reward: a coupon that
                  everybody holds is a coupon anybody can spend twice, and a code
                  that names its holder is the one that can be traced back. */}
              <p className="text-xs text-muted-foreground">
                Each member gets a code of their own. Leave this empty unless you are handing over
                a code that already exists.
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="reward-grant-note">Note</Label>
            <Textarea
              id="reward-grant-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why they are being given it."
              rows={2}
              maxLength={MAX_NOTE_LENGTH}
            />
            <p className="text-xs text-muted-foreground">
              Optional, and kept on the grant — “who gave this out, and why” is the first question
              asked of a reward somebody says they did not earn. {note.length}/{MAX_NOTE_LENGTH}
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {grantReward.isPending && <Loader2Icon className="animate-spin" />}
              Grant reward
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
