'use client';

import Link from 'next/link';
import { ArrowRightIcon, Loader2Icon, MailPlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  ORG_ROLE_LABELS,
  SPACE_MEMBER_ROLE_LABELS,
  type MyInvitation,
  type MySpaceInvitation,
} from '@/types';
import { useAcceptInvitation } from '@/modules/organization/member.queries';
import { useAcceptSpaceInvitation } from '@/modules/space-member/space-member.queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Invitations as rows, with no card around them.
 *
 * The rows live here rather than inside the panel that first showed them because
 * there are three places an invitation belongs — the organizations page, the
 * courses page, and the invitations page — and they must read as the same offer
 * in all three: same words, same Accept, same way in afterwards.
 */

/**
 * One invitation to an organization, with the one thing that can be done about
 * it.
 *
 * Accepting is all there is: there is no token to carry and nobody to approve —
 * the invitation names an email address, and being signed in as that address is
 * what accepting means.
 */
function OrganizationInvitationRow({
  invitation,
  highlighted,
}: {
  invitation: MyInvitation;
  /** The invitation the link that brought them here named. */
  highlighted: boolean;
}) {
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
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3',
        highlighted ? 'border-ring' : 'border-ring/40',
      )}
    >
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
        <Link href={`/o/${invitation.orgId}/members`} aria-label={`Open ${invitation.organizationName}`}>
          <ArrowRightIcon />
        </Link>
      </Button>
    </div>
  );
}

/**
 * One invitation to a course, with the same one thing to do about it.
 *
 * A course invitation is deliberately not an organization invitation — it can be
 * addressed to somebody with no business in the organization around it, and
 * accepting grants the course and nothing more. So it is a row of its own rather
 * than an organization with a strange role, and the way in points at the course
 * rather than at a roster that is not theirs to read.
 */
function SpaceInvitationRow({ invitation }: { invitation: MySpaceInvitation }) {
  const accept = useAcceptSpaceInvitation(invitation.spaceId);

  async function handleAccept() {
    try {
      await accept.mutateAsync();
      toast.success(`You have joined ${invitation.spaceTitle}`);
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
        <p className="truncate text-sm font-medium">{invitation.spaceTitle}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A course{invitation.organizationName ? ` from ${invitation.organizationName}` : ''} — you
          were invited as {SPACE_MEMBER_ROLE_LABELS[invitation.role].toLowerCase()}.
        </p>
      </div>
      <Badge variant="outline" className="shrink-0">
        Course
      </Badge>
      <Button size="sm" onClick={() => void handleAccept()} disabled={accept.isPending}>
        {accept.isPending && <Loader2Icon className="animate-spin" />}
        Accept
      </Button>
      <Button size="icon" variant="ghost" asChild>
        <Link
          href={`/o/${invitation.orgId}/spaces/${invitation.spaceId}`}
          aria-label={`Open ${invitation.spaceTitle}`}
        >
          <ArrowRightIcon />
        </Link>
      </Button>
    </div>
  );
}

/**
 * Every invitation addressed to the signed-in account.
 *
 * Courses are listed alongside organizations because both are offers waiting on
 * the same act — accepting one, signed in as the address it named — and because
 * somebody invited to a single course may belong to no organization at all: for
 * them the course row is the whole list.
 */
export function InvitationsList({
  orgInvitations,
  spaceInvitations,
  highlightOrgId,
}: {
  orgInvitations: MyInvitation[];
  spaceInvitations: MySpaceInvitation[];
  /** The organization an invitation link named, when one did. */
  highlightOrgId?: string;
}) {
  return (
    <div className="grid gap-3">
      {orgInvitations.map((invitation) => (
        <OrganizationInvitationRow
          key={invitation.orgId}
          invitation={invitation}
          highlighted={invitation.orgId === highlightOrgId}
        />
      ))}

      {spaceInvitations.map((invitation) => (
        <SpaceInvitationRow key={invitation.spaceId} invitation={invitation} />
      ))}
    </div>
  );
}
