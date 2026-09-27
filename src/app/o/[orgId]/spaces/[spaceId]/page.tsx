'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ChevronLeftIcon,
  GiftIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MailPlusIcon,
  UsersIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { useSpace } from '@/modules/space/space.queries';
import { useSections } from '@/modules/section/section.queries';
import { useOrganization } from '@/modules/organization/organization.queries';
import { useMySpaceInvitations } from '@/modules/space-member/space-member.queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shell/page-card';
import { SpaceAvatar } from '@/components/space/space-avatar';
import { spaceScheduleLabel } from '@/components/space/space-card';
import { SpaceOverviewTab } from '@/components/space/space-overview-tab';
import { SpaceContentTab } from '@/components/space/space-content-tab';
import { SpaceMembersTab, SpaceInvitationCard } from '@/components/space/space-members-tab';
import { SpaceCohortsTab } from '@/components/space/space-cohorts-tab';
import { SpaceRewardsTab } from '@/components/space/space-rewards-tab';

/**
 * The five things a course is: what it is, what it holds, who takes it, how they
 * are grouped, and what they are given for finishing.
 *
 * They are tabs rather than one long page because they answer different
 * questions at different times — the overview is opened to change something
 * about the course, the content tab to arrange it, and the other three when
 * somebody new arrives or somebody earns something. Kept as separate surfaces,
 * each can be as dense as its own job needs.
 */
const TAB_STRIP =
  'h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border/60 bg-transparent p-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden';

/**
 * One tab: an icon and its name, quiet until it is the one you are in.
 *
 * The underline is the only weight they carry, which is what lets five of them
 * sit on one line above a course without the strip reading as navigation the
 * page is competing with — the course's own name is the heading here.
 */
const SPACE_TAB =
  'shrink-0 gap-1.5 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-3 pb-2 pt-1 text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none [&_svg]:size-4';

function SpaceTab({
  value,
  icon,
  label,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger value={value} className={SPACE_TAB}>
      {icon}
      {label}
    </TabsTrigger>
  );
}

export default function SpacePage() {
  const { orgId, spaceId } = useParams<{ orgId: string; spaceId: string }>();
  const { data, isLoading, isError, error } = useSpace(spaceId);
  const space = data?.space;

  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== 'VIEWER' : false;

  const { data: outline, isLoading: outlineLoading } = useSections(spaceId);
  const sections = outline?.sections ?? [];
  const lessonCount = sections.reduce((total, section) => total + section.contents.length, 0);

  // Invitations are read for the signed-in user across every organization, and
  // the one naming this course is the only one this page can act on.
  const invitationsQuery = useMySpaceInvitations();
  const invitation = invitationsQuery.data?.invitations.find((entry) => entry.spaceId === spaceId);

  // An invitation email links here with the course it names, which is the only
  // way this page can tell "you were invited and have not accepted" from "this
  // course is not yours" — the offer itself grants nothing, so the read that
  // would have answered is refused either way.
  const arrivedFromInvitation = useSearchParams().get('invitation') !== null;

  const [tab, setTab] = useState('overview');

  if (isError) {
    // An invitation is readable before the course is — that is the whole point of
    // one — so somebody the course was shared with sees the offer rather than the
    // refusal the API gives an outsider. `useSpace` cannot answer for them: they
    // hold no membership yet, which is exactly what accepting changes.
    if (invitation) {
      return (
        <div className="grid gap-4 pb-4">
          <SpaceInvitationCard spaceId={spaceId} invitation={invitation} />
          <p className="text-[13px] text-muted-foreground">
            Accept the invitation and the course opens here. Nothing in it is visible before that.
          </p>
        </div>
      );
    }

    // The refusal arrives before the offer does — they are two requests — so
    // saying "forbidden" for the half second in which the invitation is still on
    // its way would be the page contradicting itself.
    if (invitationsQuery.isLoading) {
      return (
        <div className="grid gap-4 pb-4">
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      );
    }

    // A link that says it is an invitation, and no invitation for the account
    // reading it. Almost always the same mistake, and one worth naming: an
    // invitation is claimed by the address it was sent to, so a link forwarded to
    // somebody else — or opened while signed in as somebody else — is not theirs
    // to accept, and "forbidden" explains none of that.
    if (arrivedFromInvitation && !invitationsQuery.isError) {
      return (
        <EmptyState
          icon={<MailPlusIcon className="size-5 text-muted-foreground" />}
          title="This invitation is not for this account"
          description="An invitation is claimed by the email address it was sent to. Sign in as that address, or ask whoever invited you to send another one."
          action={
            <Button variant="outline" asChild>
              <Link href="/invites">Your invitations</Link>
            </Button>
          }
        />
      );
    }

    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Failed to load this space'}
      </p>
    );
  }

  if (isLoading || !space) {
    return (
      <div className="grid gap-8">
        <Skeleton className="h-44 rounded-2xl" />
        <div className="grid gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  // What the course adds up to, above its name the way a subtitle reads. The
  // type is not repeated here: the line below already says how the space runs.
  const eyebrow = [
    sections.length > 0 ? `${sections.length} section${sections.length === 1 ? '' : 's'}` : null,
    lessonCount > 0 ? `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="grid gap-6 pb-4">
      <Link
        href={`/o/${orgId}/spaces`}
        className="-mb-2 inline-flex w-fit items-center gap-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Spaces
      </Link>

      <header className="flex items-start gap-4">
        {/* The course's own colour, and its mark. With the banner living in the
            overview tab beside the control that changes it, this is what the page
            is recognised by, so it is drawn larger than the list's. */}
        <SpaceAvatar space={space} size="lg" className="size-12 rounded-xl text-lg shadow-sm" />

        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {space.title}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{spaceScheduleLabel(space)}</p>

          {space.description && (
            <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {space.description}
            </p>
          )}
        </div>
      </header>

      {/* An offer waiting for the signed-in user, above everything: a course can
          be shared with somebody who is not in the organization at all, and until
          they take it up there is nothing else on this page that is theirs. */}
      {invitation && <SpaceInvitationCard spaceId={spaceId} invitation={invitation} />}

      {/* Controlled rather than defaulted: the tab is a place the reader is in,
          and coming back to the course should not lose it. */}
      <Tabs value={tab} onValueChange={setTab} className="grid gap-4">
        <TabsList className={TAB_STRIP}>
          <SpaceTab
            value="overview"
            icon={<LayoutDashboardIcon />}
            label="Overview"
          />
          <SpaceTab value="content" icon={<LayersIcon />} label="Content" />
          <SpaceTab value="members" icon={<UsersIcon />} label="Members" />
          <SpaceTab value="cohorts" icon={<UsersRoundIcon />} label="Cohorts" />
          <SpaceTab value="rewards" icon={<GiftIcon />} label="Rewards" />
        </TabsList>

        <TabsContent value="overview" className="mt-2">
          <SpaceOverviewTab space={space} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="content" className="mt-2">
          <SpaceContentTab
            orgId={orgId}
            spaceId={spaceId}
            sections={sections}
            truncated={outline?.truncated ?? false}
            loading={outlineLoading}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="members" className="mt-2">
          <SpaceMembersTab spaceId={spaceId} canManage={canEdit} invitation={invitation} />
        </TabsContent>

        <TabsContent value="cohorts" className="mt-2">
          <SpaceCohortsTab spaceId={spaceId} canManage={canEdit} />
        </TabsContent>

        <TabsContent value="rewards" className="mt-2">
          <SpaceRewardsTab spaceId={spaceId} canManage={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
