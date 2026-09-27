'use client';

import { useState } from 'react';
import { Loader2Icon, MailPlusIcon, UserPlusIcon, UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAcceptSpaceInvitation, useSpaceMembers } from '@api/modules/space-member/space-member.queries';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { BlockLabel, EmptyState } from '@/components/shell/page-card';
import { InviteSpaceMemberDialog } from '@/components/space/invite-space-member-dialog';
import { SpaceMemberRow } from '@/components/space/space-member-row';
import { SPACE_MEMBER_ROLE_LABELS, type MySpaceInvitation } from '@play/types';

/**
 * The offer that is waiting, shown to somebody the course was shared with.
 *
 * A course invitation can be addressed to somebody who is not in the
 * organization at all, so this is the one card on the page they can act on
 * before anything else is theirs.
 */
export function SpaceInvitationCard({
  spaceId,
  invitation,
}: {
  spaceId: string;
  invitation: MySpaceInvitation;
}) {
  const accept = useAcceptSpaceInvitation(spaceId);

  async function handleAccept() {
    try {
      await accept.mutateAsync();
      toast.success(`You have joined ${invitation.spaceTitle}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not accept the invitation');
    }
  }

  return (
    <section className="rounded-2xl border border-ring/40 bg-card p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted/40">
          <MailPlusIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">
            You have been invited to {invitation.spaceTitle}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            As {SPACE_MEMBER_ROLE_LABELS[invitation.role].toLowerCase()}
            {invitation.organizationName ? `, a course from ${invitation.organizationName}` : ''}. The
            course is yours to read once you accept.
          </p>
        </div>
        <Button onClick={() => void handleAccept()} disabled={accept.isPending}>
          {accept.isPending && <Loader2Icon className="animate-spin" />}
          Accept invitation
        </Button>
      </div>
    </section>
  );
}

/**
 * Who is taking the course.
 *
 * The roster is the course's own, not the organization's: the people here were
 * invited to *this* course, and some of them have no other business in the
 * organization around it.
 *
 * A caller who is not in the course at all never sees this list — the API refuses
 * the roster to somebody who is not a member, and the tab says so rather than
 * showing an empty table. The invitation they hold is offered by the page above
 * the tabs, where it is visible from every tab rather than only this one.
 */
export function SpaceMembersTab({
  spaceId,
  canManage,
  invitation,
}: {
  spaceId: string;
  canManage: boolean;
  /** Set when the signed-in user has an outstanding invitation to this course. */
  invitation?: MySpaceInvitation;
}) {
  const membersQuery = useSpaceMembers(spaceId);
  const [tab, setTab] = useState<'members' | 'invitations'>('members');

  const members = membersQuery.data?.members ?? [];
  const invited = members.filter((member) => member.pending);
  const joined = members.filter((member) => !member.pending);
  const shown = tab === 'members' ? joined : invited;
  const inviteUrl = membersQuery.data?.inviteUrl;

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <BlockLabel
          action={
            canManage ? (
              <InviteSpaceMemberDialog
                spaceId={spaceId}
                trigger={
                  <Button size="sm">
                    <UserPlusIcon />
                    Invite
                  </Button>
                }
              />
            ) : undefined
          }
        >
          Members
        </BlockLabel>

        <div className="flex items-center gap-1.5">
          {(
            [
              ['members', `Students and staff${joined.length ? ` · ${joined.length}` : ''}`],
              ['invitations', `Invitations${invited.length ? ` · ${invited.length}` : ''}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={
                tab === value
                  ? 'rounded-full border border-ring bg-muted/50 px-3 py-1 text-xs font-medium'
                  : 'rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground'
              }
            >
              {label}
            </button>
          ))}
        </div>

        {membersQuery.isError ? (
          <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {membersQuery.error instanceof Error
                ? membersQuery.error.message
                : 'The roster could not be read.'}
            </p>
            {invitation && (
              <p className="mt-1 text-xs text-muted-foreground">
                Accept the invitation above and the course becomes yours to read.
              </p>
            )}
          </div>
        ) : membersQuery.isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="size-5 text-muted-foreground" />}
            title={tab === 'members' ? 'Nobody has joined yet' : 'No invitations outstanding'}
            description={
              tab === 'members'
                ? canManage
                  ? 'Invite somebody by email address. They can be a student, an assistant, or an instructor.'
                  : 'Nobody has accepted an invitation to this course yet.'
                : 'Every invitation sent for this course has been accepted or withdrawn.'
            }
            action={
              tab === 'members' && canManage ? (
                <InviteSpaceMemberDialog
                  spaceId={spaceId}
                  trigger={
                    <Button>
                      <UserPlusIcon />
                      Invite someone
                    </Button>
                  }
                />
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3">
            {shown.map((member) => (
              <SpaceMemberRow
                key={member.userId}
                spaceId={spaceId}
                member={member}
                canManage={canManage}
                inviteUrl={inviteUrl}
              />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <BlockLabel>What members are here as</BlockLabel>
        <dl className="grid gap-2">
          {(['STUDENT', 'ASSISTANT', 'INSTRUCTOR'] as const).map((role) => (
            <div key={role} className="flex items-start gap-3 rounded-xl border px-4 py-3">
              <Badge variant={role === 'STUDENT' ? 'outline' : 'secondary'} className="mt-0.5 shrink-0">
                {SPACE_MEMBER_ROLE_LABELS[role]}
              </Badge>
              <dd className="text-xs text-muted-foreground">
                {role === 'STUDENT'
                  ? 'Taking the course — the people the student count is made of.'
                  : role === 'ASSISTANT'
                    ? 'Helping run it: sees the roster and everything in the course.'
                    : 'Runs the course, and is named as the one who does.'}
              </dd>
            </div>
          ))}
        </dl>
        {!canManage && (
          <p className="text-xs text-muted-foreground">
            Only an organization admin or editor can invite people to a course or change what they
            are here as. Ask an admin if somebody is missing.
          </p>
        )}
      </section>
    </div>
  );
}
