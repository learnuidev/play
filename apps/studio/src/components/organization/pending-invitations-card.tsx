import { PageCard } from '@/components/shell/page-card';
import { InvitationsList } from './invitations-list';
import type { MyInvitation, MySpaceInvitation } from '@/types';

/**
 * The invitations waiting for the signed-in account, wherever they came from, as
 * a panel on a page that has other things on it.
 *
 * The rows themselves are `InvitationsList`, because the invitations *are* the
 * page at `/invites` — there it is a list under a heading, and here it is a card
 * above whichever page is being read.
 *
 * `highlightOrgId` is the one an invitation link named: an email points here with
 * the offer it was about, and pointing at a *page* rather than at a token means
 * the link still has to say which offer it meant.
 */
export function PendingInvitationsCard({
  invitations,
  spaceInvitations = [],
  highlightOrgId,
}: {
  invitations: MyInvitation[];
  /** Course invitations addressed to the same address, if any. */
  spaceInvitations?: MySpaceInvitation[];
  highlightOrgId?: string;
}) {
  const total = invitations.length + spaceInvitations.length;
  if (total === 0) return null;

  return (
    <PageCard
      title={total === 1 ? 'You have an invitation' : 'You have invitations'}
      description="Addressed to your email address. Nothing is visible until you accept."
    >
      <InvitationsList
        orgInvitations={invitations}
        spaceInvitations={spaceInvitations}
        highlightOrgId={highlightOrgId}
      />
    </PageCard>
  );
}
