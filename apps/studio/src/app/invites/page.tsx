'use client';

import Link from 'next/link';
import { MailCheckIcon } from 'lucide-react';
import { useMyInvitations } from '@/modules/organization/member.queries';
import { useMySpaceInvitations } from '@/modules/space-member/space-member.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shell/page-card';
import { InvitationsList } from '@/components/organization/invitations-list';

/**
 * Everything waiting to be accepted, in one place.
 *
 * There are two kinds of invitation in this app and they used to live on
 * different pages — an organization on the organizations page, a course on the
 * courses page — which meant somebody had to know which kind they had been sent
 * before they knew where to look. Both are offers addressed to an email address
 * and accepted the same way, so both are here.
 *
 * Deliberately only what is addressed to *you*: invitations you have sent are
 * managed where they were sent from, on an organization's members page or a
 * course's members tab, and mixing the two would make this page half an inbox
 * and half an outbox.
 */
export default function InvitationsPage() {
  const orgQuery = useMyInvitations();
  const courseQuery = useMySpaceInvitations();

  const orgInvitations = orgQuery.data?.invitations ?? [];
  const spaceInvitations = courseQuery.data?.invitations ?? [];
  const loading = orgQuery.isLoading || courseQuery.isLoading;
  const total = orgInvitations.length + spaceInvitations.length;

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">Invitations</h1>
        <p className="text-[13px] text-muted-foreground">
          Addressed to your email address. Nothing is visible until you accept.
        </p>
      </header>

      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={<MailCheckIcon className="size-5 text-muted-foreground" />}
          title="Nothing is waiting for you"
          description="An invitation to an organization or to a course shows up here as soon as it is addressed to your email address."
          action={
            <Button variant="outline" asChild>
              <Link href="/spaces">Your spaces</Link>
            </Button>
          }
        />
      ) : (
        <InvitationsList
          orgInvitations={orgInvitations}
          spaceInvitations={spaceInvitations}
        />
      )}
    </div>
  );
}
