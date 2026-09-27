'use client';

import { useState } from 'react';
import {
  CheckIcon,
  LinkIcon,
  Loader2Icon,
  MailIcon,
  MoreHorizontalIcon,
  SendIcon,
  UserMinusIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  SPACE_MEMBER_ROLES,
  SPACE_MEMBER_ROLE_LABELS,
  type SpaceMemberApi,
  type SpaceMemberRole,
} from '@/types';
import {
  useRemoveSpaceMember,
  useResendSpaceInvitation,
  useUpdateSpaceMember,
} from '@/modules/space-member/space-member.queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Who a member is, in words, without giving an address away to somebody who
 * cannot use it: only whoever may manage the roster is shown addresses, and
 * everyone else sees who the row *is* rather than what it is keyed by.
 */
function displayName(member: SpaceMemberApi): string {
  if (member.isYou) return 'You';
  if (member.email) return member.email;
  if (member.pending) return 'Invited';
  return `Member ${member.userId.slice(0, 6)}`;
}

/**
 * One row of a course's roster: who it is, what they are here as, and — for
 * whoever may manage it — what to do about it.
 *
 * An outstanding invitation is a different thing to act on from a membership:
 * what it needs is sending again, not a new role, and the menu says so.
 */
export function SpaceMemberRow({
  spaceId,
  member,
  canManage,
  inviteUrl,
  children,
}: {
  spaceId: string;
  member: SpaceMemberApi;
  /** The caller may invite, remove and re-role, so this row can be acted on. */
  canManage: boolean;
  /** Where an invitation to this course is claimed, for copying. */
  inviteUrl?: string;
  /** Extra trailing controls, e.g. the cohort picker's add button. */
  children?: React.ReactNode;
}) {
  const [removing, setRemoving] = useState(false);
  const updateRole = useUpdateSpaceMember(spaceId);
  const remove = useRemoveSpaceMember(spaceId);
  const resend = useResendSpaceInvitation(spaceId);

  const busy = updateRole.isPending || remove.isPending || resend.isPending;
  const canAct = canManage && !member.isYou;

  async function resendInvitation() {
    try {
      const { delivery } = await resend.mutateAsync({ memberId: member.userId });
      if (delivery.sent) {
        toast.success(`Invitation sent again to ${member.email ?? member.userId}`);
      } else {
        toast.warning('The invitation is still outstanding, but the email did not go out', {
          description: delivery.error,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the invitation again');
    }
  }

  /** The invite path that does not depend on mail being set up at all. */
  async function copyInviteLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success('Invitation link copied', {
        description: 'Send it to them yourself — they sign in with the invited address.',
      });
    } catch {
      toast.error('Could not copy the link', { description: inviteUrl });
    }
  }

  async function changeRole(role: SpaceMemberRole) {
    if (role === member.role) return;
    try {
      await updateRole.mutateAsync({ memberId: member.userId, role });
      toast.success(`Now ${SPACE_MEMBER_ROLE_LABELS[role].toLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change what they are here as');
    }
  }

  async function removeMember() {
    try {
      await remove.mutateAsync(member.userId);
      toast.success(member.pending ? 'Invitation withdrawn' : 'Removed from the course');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove them');
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted/40">
        {member.pending ? (
          <MailIcon className="size-4 text-muted-foreground" />
        ) : (
          <span className="text-xs font-semibold uppercase">
            {displayName(member).slice(0, 2)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{displayName(member)}</p>
          {member.pending && (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Invited — not joined yet
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {member.pending
            ? 'What they are here as applies once they sign in and accept.'
            : member.isYou
              ? 'This is you.'
              : `Joined ${new Date(member.joinedAt).toLocaleDateString()}`}
        </p>
      </div>

      {children}

      <Badge variant={member.role === 'STUDENT' ? 'outline' : 'secondary'} className="shrink-0">
        {SPACE_MEMBER_ROLE_LABELS[member.role]}
      </Badge>

      {canAct && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Member actions" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>What they are here as</DropdownMenuLabel>
            {SPACE_MEMBER_ROLES.map((role) => (
              <DropdownMenuItem
                key={role}
                onSelect={() => void changeRole(role)}
                className={cn('justify-between', role === member.role && 'font-medium')}
              >
                {SPACE_MEMBER_ROLE_LABELS[role]}
                {role === member.role && <CheckIcon className="size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {member.pending && (
              <>
                <DropdownMenuItem onSelect={() => void resendInvitation()}>
                  <SendIcon className="size-4" />
                  Send invitation again
                </DropdownMenuItem>
                {inviteUrl && (
                  <DropdownMenuItem onSelect={() => void copyInviteLink()}>
                    <LinkIcon className="size-4" />
                    Copy invitation link
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            {removing ? (
              <div className="grid gap-2 p-2">
                <p className="text-xs text-muted-foreground">
                  {member.pending ? 'Withdraw this invitation?' : 'Remove them from this course?'}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    onClick={() => void removeMember()}
                  >
                    Yes
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => setRemoving(false)}
                  >
                    No
                  </Button>
                </div>
              </div>
            ) : (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={(event) => {
                  // Keep the menu open so the confirmation lands where the action
                  // was taken rather than beside a row that has moved back.
                  event.preventDefault();
                  setRemoving(true);
                }}
              >
                <UserMinusIcon className="size-4" />
                {member.pending ? 'Withdraw invitation' : 'Remove from this course'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
