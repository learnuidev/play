'use client';

import { useParams } from 'next/navigation';
import { Loader2Icon, MailPlusIcon, UserPlusIcon, UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  ORG_ROLES,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_LABELS,
  type OrgMemberApi,
} from '@play/types';
import { ApiError } from '@api/lib/api';
import { useOrganization } from '@api/modules/organization/organization.queries';
import { useAcceptInvitation, useMembers, useMyInvitations } from '@api/modules/organization/member.queries';
import { Badge } from '@ui/components/ui/badge';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { EmptyState, PageCard } from '@/components/shell/page-card';
import { InviteMemberDialog } from '@/components/organization/invite-member-dialog';
import { MemberRow } from '@/components/organization/member-row';

const ROLE_VARIANT = {
  ADMIN: 'default',
  EDITOR: 'secondary',
  VIEWER: 'outline',
} as const;

/**
 * The offer that is waiting, shown to somebody who has not accepted it yet.
 *
 * It comes first on the page and is the only thing on it when the caller is not
 * a member: nothing else here is theirs to see until they take it up.
 */
function PendingInvitationCard({
  orgId,
  organizationName,
  role,
}: {
  orgId: string;
  organizationName: string;
  role: OrgMemberApi['role'];
}) {
  const accept = useAcceptInvitation(orgId);

  async function handleAccept() {
    try {
      await accept.mutateAsync();
      toast.success(`You have joined ${organizationName}`);
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
            You have been invited to {organizationName}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            As {ORG_ROLE_LABELS[role].toLowerCase()} — {ORG_ROLE_DESCRIPTIONS[role].toLowerCase()}{' '}
            Nothing is visible to you until you accept.
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

/** The role reference, which is useful whether or not the caller can act. */
function RolesCard({ organizationName, isAdmin }: { organizationName?: string; isAdmin: boolean }) {
  return (
    <PageCard title="Roles" description="What each role may do inside this organization.">
      <dl className="grid gap-3">
        {ORG_ROLES.map((role) => (
          <div key={role} className="flex items-start gap-3 rounded-xl border px-4 py-3">
            <Badge variant={ROLE_VARIANT[role]} className="mt-0.5 shrink-0">
              {ORG_ROLE_LABELS[role]}
            </Badge>
            <dd className="text-xs text-muted-foreground">{ORG_ROLE_DESCRIPTIONS[role]}</dd>
          </div>
        ))}
      </dl>
      {!isAdmin && (
        <p className="mt-4 text-xs text-muted-foreground">
          Only an admin{organizationName ? ` of ${organizationName}` : ''} can invite people or
          change what they may do.
        </p>
      )}
    </PageCard>
  );
}

export default function OrganizationMembersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const organizationQuery = useOrganization(orgId);
  const membersQuery = useMembers(orgId);
  const invitationsQuery = useMyInvitations();

  const organization = organizationQuery.data?.organization;
  const members = membersQuery.data?.members ?? [];
  // The caller's role comes from the roster rather than from the organization,
  // so the page and the API cannot disagree about what may be offered.
  const isAdmin = membersQuery.data?.role === 'ADMIN';

  const myInvitation = invitationsQuery.data?.invitations.find(
    (invitation) => invitation.orgId === orgId,
  );

  const forbidden = membersQuery.error instanceof ApiError && membersQuery.error.status === 403;

  // Not a member yet, but invited. The roster is not the caller's to read and
  // the API says so; the invitation is, and accepting it is the whole page.
  if (forbidden) {
    return (
      <div className="grid gap-6">
        {myInvitation && (
          <PendingInvitationCard
            orgId={orgId}
            organizationName={myInvitation.organizationName}
            role={myInvitation.role}
          />
        )}
        <PageCard
          title="Members"
          description="Who can see and change what this organization owns."
        >
          <EmptyState
            icon={<UsersIcon className="size-5 text-muted-foreground" />}
            title={myInvitation ? 'Accept the invitation first' : 'You are not a member'}
            description={
              myInvitation
                ? 'The roster is the organization’s own. Accepting the invitation is what makes it yours to read.'
                : 'Only members of this organization can see who is in it. Ask an admin for an invitation.'
            }
          />
        </PageCard>
        <RolesCard organizationName={organization?.name} isAdmin={false} />
      </div>
    );
  }

  const invitations = members.filter((member) => member.pending);
  const joined = members.filter((member) => !member.pending);

  return (
    <div className="grid gap-6">
      {myInvitation && organization && (
        <PendingInvitationCard
          orgId={orgId}
          organizationName={myInvitation.organizationName}
          role={myInvitation.role}
        />
      )}

      <PageCard
        title="Members"
        description="Who can see and change what this organization owns."
        actions={
          isAdmin ? (
            <InviteMemberDialog
              orgId={orgId}
              trigger={
                <Button size="sm">
                  <UserPlusIcon />
                  Invite member
                </Button>
              }
            />
          ) : undefined
        }
      >
        {membersQuery.isError ? (
          <p className="text-sm text-destructive">
            {membersQuery.error instanceof Error
              ? membersQuery.error.message
              : 'Failed to load the members'}
          </p>
        ) : membersQuery.isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : joined.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="size-5 text-muted-foreground" />}
            title="Nobody here yet"
            description={
              isAdmin
                ? 'Invite a teammate by email address. They can be an admin, an editor, or a viewer.'
                : 'You are the only member of this organization.'
            }
            action={
              isAdmin ? (
                <InviteMemberDialog
                  orgId={orgId}
                  trigger={
                    <Button>
                      <UserPlusIcon />
                      Invite member
                    </Button>
                  }
                />
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3">
            {joined.map((member) => (
              <MemberRow
                key={member.userId}
                orgId={orgId}
                member={member}
                canManage={isAdmin}
                isOwner={member.userId === membersQuery.data?.ownerId}
              />
            ))}
          </div>
        )}
      </PageCard>

      {invitations.length > 0 && (
        <PageCard
          title="Invitations"
          description="Sent, and not accepted yet. An invitation grants nothing until it is."
        >
          <div className="grid gap-3">
            {invitations.map((member) => (
              <MemberRow
                key={member.userId}
                orgId={orgId}
                member={member}
                canManage={isAdmin}
                isOwner={false}
                inviteUrl={membersQuery.data?.inviteUrl}
              />
            ))}
          </div>
        </PageCard>
      )}

      <RolesCard organizationName={organization?.name} isAdmin={isAdmin} />
    </div>
  );
}
