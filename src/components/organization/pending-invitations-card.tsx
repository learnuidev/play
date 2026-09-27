'use client';

import { ArrowRightIcon, Loader2Icon, MailPlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ORG_ROLE_LABELS, type MyInvitation } from '@/types';
import { useAcceptInvitation } from '@/modules/organization/member.queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageCard } from '@/components/shell/page-card';

/**
 * One invitation, with the one thing that can be done about it.
 *
 * Accepting is all there is: there is no token to carry and nobody to approve —
 * the invitation names an email address, and being signed in as that address is
 * what accepting means.
 */
function InvitationRow({ invitation }: { invitation: MyInvitation }) {
  const accept = useAcceptInvitation(invitation.orgId);

  async function handleAccept() {
    try {
      await accept.mutateAsync();
      toast.success(`You have joined ${invitation.organizationName}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not accept the invitation');
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-ring/40 bg-muted/30 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-background">
        <MailPlusIcon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invitation.organizationName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          You were invited as {ORG_ROLE_LABELS[invitation.role].toLowerCase()}.
        </p>
      </div>
      <Badge variant="outline" className="shrink-0">
        {ORG_ROLE_LABELS[invitation.role]}
      </Badge>
      <Button size="sm" onClick={() => void handleAccept()} disabled={accept.isPending}>
        {accept.isPending && <Loader2Icon className="animate-spin" />}
        Accept
      </Button>
      <Button size="icon" variant="ghost" asChild>
        <a
          href={`/o/${invitation.orgId}/members`}
          aria-label={`Open ${invitation.organizationName}`}
        >
          <ArrowRightIcon />
        </a>
      </Button>
    </div>
  );
}

/**
 * The invitations waiting for the signed-in account, wherever they came from.
 *
 * This is the only place somebody who belongs nowhere yet can find out they
 * were invited at all, so it is rendered on the page listing communities rather
 * than inside one — there is no organization to be inside yet.
 */
export function PendingInvitationsCard({ invitations }: { invitations: MyInvitation[] }) {
  if (invitations.length === 0) return null;

  return (
    <PageCard
      title={invitations.length === 1 ? 'You have an invitation' : 'You have invitations'}
      description="Addressed to your email address. Nothing is visible until you accept."
    >
      <div className="grid gap-3">
        {invitations.map((invitation) => (
          <InvitationRow key={invitation.orgId} invitation={invitation} />
        ))}
      </div>
    </PageCard>
  );
}
