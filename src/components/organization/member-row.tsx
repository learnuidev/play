'use client';

import { useState } from 'react';
import { CheckIcon, Loader2Icon, MailIcon, MoreHorizontalIcon, UserMinusIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  ORG_ROLES,
  ORG_ROLE_LABELS,
  type OrgMemberApi,
  type OrgRole,
} from '@/types';
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
import { useRemoveMember, useUpdateMemberRole } from '@/modules/organization/member.queries';
import { cn } from '@/lib/utils';

const ROLE_VARIANT = {
  ADMIN: 'default',
  EDITOR: 'secondary',
  VIEWER: 'outline',
} as const;

/**
 * Who a member is, in words, without giving an email address away to somebody
 * who cannot use it: only an admin is shown addresses by the API, and everyone
 * else sees who the row *is* rather than what it is keyed by.
 */
function displayName(member: OrgMemberApi, isOwner: boolean): string {
  if (member.isYou) return 'You';
  if (member.email) return member.email;
  if (member.pending) return 'Invited';
  return `Member ${member.userId.slice(0, 6)}`;
}

/**
 * One row of the roster: who it is, what they may do, and — for an admin, and
 * for somebody who is not the owner or themselves — what to do about it.
 *
 * The owner's row carries no controls at all: they cannot be demoted or
 * removed, and offering either only to fail is worse than not offering it.
 */
export function MemberRow({
  orgId,
  member,
  canManage,
  isOwner,
  children,
}: {
  orgId: string;
  member: OrgMemberApi;
  /** The caller is an admin, so this row can be acted on. */
  canManage: boolean;
  isOwner: boolean;
  /** Extra trailing controls: the Accept button on the caller's own invitation. */
  children?: React.ReactNode;
}) {
  const [removing, setRemoving] = useState(false);
  const updateRole = useUpdateMemberRole(orgId);
  const remove = useRemoveMember(orgId);

  const busy = updateRole.isPending || remove.isPending;
  const canAct = canManage && !isOwner && !member.isYou;

  async function changeRole(role: OrgRole) {
    if (role === member.role) return;
    try {
      await updateRole.mutateAsync({ memberId: member.userId, role });
      toast.success(`Now ${ORG_ROLE_LABELS[role].toLowerCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the role');
    }
  }

  async function removeMember() {
    try {
      await remove.mutateAsync(member.userId);
      toast.success(member.pending ? 'Invitation withdrawn' : 'Member removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the member');
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted/40">
        {member.pending ? (
          <MailIcon className="size-4 text-muted-foreground" />
        ) : (
          <span className="text-xs font-semibold uppercase">
            {displayName(member, isOwner).slice(0, 2)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{displayName(member, isOwner)}</p>
          {isOwner && (
            <Badge variant="outline" className="font-normal">
              Owner
            </Badge>
          )}
          {member.pending && (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Invited — not joined yet
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {member.pending
            ? 'This role applies once they sign in and accept.'
            : member.isYou
              ? 'This is you.'
              : `Joined ${new Date(member.joinedAt).toLocaleDateString()}`}
        </p>
      </div>

      <Badge variant={ROLE_VARIANT[member.role]} className="shrink-0">
        {ORG_ROLE_LABELS[member.role]}
      </Badge>

      {children}

      {canAct && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Member actions" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Role</DropdownMenuLabel>
            {ORG_ROLES.map((role) => (
              <DropdownMenuItem
                key={role}
                onSelect={() => void changeRole(role)}
                className={cn('justify-between', role === member.role && 'font-medium')}
              >
                {ORG_ROLE_LABELS[role]}
                {role === member.role && <CheckIcon className="size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {removing ? (
              <div className="grid gap-2 p-2">
                <p className="text-xs text-muted-foreground">
                  {member.pending
                    ? 'Withdraw this invitation?'
                    : 'Remove them from the organization?'}
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
                  // Keep the menu open so the confirmation lands where the
                  // action was taken, rather than beside a row that has moved
                  // back to its resting state.
                  event.preventDefault();
                  setRemoving(true);
                }}
              >
                <UserMinusIcon className="size-4" />
                {member.pending ? 'Withdraw invitation' : 'Remove from organization'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
