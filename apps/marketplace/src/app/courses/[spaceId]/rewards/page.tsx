'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  BadgeCheckIcon,
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  GiftIcon,
  TicketIcon,
} from 'lucide-react';
import { useMyRewards } from '@play/api';
import { useAuthStatus } from '@play/auth';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { REWARD_KIND_LABELS, type MyReward } from '@play/types';
import { useEnrollment } from '@/components/use-enrolled';
import { useCourseView } from '@/components/use-course-view';

/**
 * What this course has given you.
 *
 * This is where a reward email lands, and it is the reason the link goes to the
 * *course* rather than to a list of everything: what somebody was told they had
 * been given is what should be on the screen when they arrive, in the course it
 * came from, with the code they need to use it.
 *
 * Only the caller's own grants are ever here — the endpoint is scoped to their
 * `sub` — and a revoked one is left out by the API, because what was taken back
 * is not something to show somebody as theirs.
 */
export default function CourseRewardsPage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const status = useAuthStatus();
  const { enrolled, isLoading: enrollmentLoading } = useEnrollment(spaceId);
  const { course } = useCourseView(spaceId);

  const ready = status === 'authenticated' && !enrollmentLoading;

  if (status === 'configuring' || (status === 'authenticated' && enrollmentLoading)) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-12">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 rounded-3xl" />
      </div>
    );
  }

  if (status === 'unauthenticated' || !enrolled) {
    return (
      <div className="mx-auto flex min-h-[60svh] w-full max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <GiftIcon className="size-5 text-muted-foreground/60" />
        <h1 className="text-lg font-semibold">
          {status === 'unauthenticated' ? 'Sign in to see your rewards' : 'Register to earn rewards'}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {status === 'unauthenticated'
            ? 'Rewards belong to the account that earned them. Sign in and you will come straight back.'
            : 'Rewards are given to the people taking a course. Register for it and its rewards are yours to earn.'}
        </p>
        <Button asChild className="mt-1 rounded-full">
          <Link
            href={
              status === 'unauthenticated'
                ? `/sign-in?next=${encodeURIComponent(`/courses/${spaceId}/rewards`)}`
                : `/courses/${spaceId}`
            }
          >
            {status === 'unauthenticated' ? 'Sign in' : 'See the course'}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <Link
        href={`/courses/${spaceId}`}
        className="inline-flex items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        {course?.title ?? 'Course'}
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your rewards</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          {course ? `What ${course.title} has given you.` : 'What this course has given you.'}
        </p>
      </header>

      {ready && <Rewards spaceId={spaceId} />}
    </div>
  );
}

function Rewards({ spaceId }: { spaceId: string }) {
  const { data, isLoading, isError, error } = useMyRewards();

  // The endpoint answers across every course, so the course's own page is a
  // filter over it — a learner holds a handful of rewards, not a list that needs
  // a query of its own.
  const mine = (data?.rewards ?? []).filter((reward) => reward.spaceId === spaceId);

  if (isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Could not load your rewards'}
      </p>
    );
  }

  if (mine.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border/70 px-6 py-16 text-center">
        <GiftIcon className="size-6 text-muted-foreground/50" />
        <p className="text-lg font-medium tracking-tight">Nothing yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Rewards appear here when you earn one — by finishing the course, reaching a milestone, or
          being given one by an instructor.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4">
      {mine.map((reward) => (
        <li key={reward.rewardId}>
          <RewardCard grant={reward} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One reward: what it is, what it is worth using, and how to use it.
 *
 * The code is the point of the card, so it is drawn as one — monospaced, on its
 * own line, with a single tap to copy it. Everything else is context: what it
 * was for, who gave it, and what to do with it.
 */
function RewardCard({ grant }: { grant: MyReward }) {
  const [copied, setCopied] = useState(false);
  const reward = grant.reward;
  const redeemed = grant.status === 'REDEEMED';

  async function copy() {
    if (!grant.code) return;
    try {
      await navigator.clipboard.writeText(grant.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the code — select it by hand');
    }
  }

  return (
    <article className="overflow-hidden rounded-3xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TicketIcon className="size-3.5" />
            {REWARD_KIND_LABELS[reward.kind]}
          </div>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight">{reward.name}</h2>
          {reward.description && (
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {reward.description}
            </p>
          )}
        </div>

        {redeemed && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <BadgeCheckIcon className="size-3.5" />
            Used
          </span>
        )}
      </div>

      <div className="px-6 pt-5 pb-6">
        {grant.code ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3">
            <span className="font-mono text-lg font-semibold tracking-wider">{grant.code}</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1.5 rounded-full"
              onClick={() => void copy()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        ) : (
          <p className="rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
            {reward.instructions || 'This one is arranged with the instructor — see the note below.'}
          </p>
        )}

        {(grant.note || reward.instructions) && grant.code && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {grant.note ?? reward.instructions}
          </p>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          {grant.grantedBy === 'SYSTEM'
            ? 'Earned'
            : 'Given to you'}{' '}
          {new Date(grant.grantedAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>
    </article>
  );
}
