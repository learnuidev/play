'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeftIcon } from 'lucide-react';
import { useContent } from '@api/modules/content/content.queries';
import { useOrganization } from '@api/modules/organization/organization.queries';
import { Skeleton } from '@ui/components/ui/skeleton';
import { QuizPanel } from '@learning/components/quiz/quiz-panel';

/**
 * A quiz, where the author writes it.
 *
 * The same page a lesson opens on — the route does not change — and a different
 * surface because a quiz is a different thing: no player, no transcript, no
 * discussion of a moment in a video. The classroom would draw all of those and
 * have nothing to put in them.
 *
 * What it keeps from the lesson page is the way back and the heading, because
 * where you are should not depend on what kind of content you opened.
 *
 * A viewer — an organization member with the read-only role — gets the same page
 * with no controls: the panel asks for the questions with a write on the quiz,
 * which a viewer does not have, so it never has an answer key to show.
 */
export function QuizPage() {
  const { orgId, spaceId, contentId } = useParams<{
    orgId: string;
    spaceId: string;
    contentId: string;
  }>();

  const { data, isLoading } = useContent(contentId);
  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== 'VIEWER' : false;
  const content = data?.content;

  if (isLoading || !content) {
    return (
      <div className="grid gap-6 pb-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-9 w-40 rounded-full" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 pb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href={`/o/${orgId}/spaces/${spaceId}`}
          className="inline-flex min-w-0 items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4 shrink-0" />
          <h1 className="truncate">{content.title}</h1>
        </Link>
      </div>

      {/* `orgId` is not decoration: it is what the pickers inside the panel read
          the organization's banks and courses through, and without it the panel
          has no authoring dialogs to open. */}
      <QuizPanel
        contentId={contentId}
        spaceId={spaceId}
        orgId={orgId}
        canEdit={canEdit}
        title={content.title}
      />
    </div>
  );
}
