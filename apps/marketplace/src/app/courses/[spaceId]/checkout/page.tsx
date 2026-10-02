'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  BadgeCheckIcon,
  CirclePlayIcon,
  Loader2Icon,
  RefreshCcwIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { useStartCheckout } from '@play/api';
import { useAuthStatus } from '@play/auth';
import { spaceAccentColor } from '@learning/components/space/space-avatar';
import { Button, Skeleton, formatPrice, isPaid } from '@play/ui';
import { REFUND_WINDOW_DAYS, type CourseCheckoutResponse, type PublicInstructor } from '@play/types';
import { accentInk } from '@/lib/stripe-appearance';
import { CheckoutPaymentForm } from '@/components/checkout/payment-form';
import { useCourseView } from '@/components/use-course-view';
import { useEnrollment } from '@/components/use-enrolled';

/**
 * Buying a course, on a page this product drew.
 *
 * ## Why this is a page and not a redirect
 *
 * It used to be one: pressing Pay opened a Stripe checkout session and sent the
 * browser to Stripe's own page, which is a good page and not this product's. The
 * screen where somebody decides to trust a course with a card number is the
 * wrong place to hand over the brand, so the form is drawn here — with Stripe
 * Elements, which is still Stripe collecting the number inside an iframe this
 * app cannot read. What is different is who chose the fields around it, the
 * order summary beside it, and the colour they are drawn in.
 *
 * ## What this page is allowed to know
 *
 * Nothing that would let it enrol anybody. It asks the API for a payment intent
 * and draws a form for it; the money is Stripe's news, delivered to the webhook,
 * and **the membership is written there**. So a payment that succeeds sends the
 * reader back to the course page, whose panel knows how to wait for a webhook it
 * cannot see — this page would only be guessing.
 *
 * ## The five ways somebody arrives here
 *
 * Bought already, not signed in, a course that turns out to be free, a course
 * that is not there, and the ordinary case. Each of the first four is a state
 * rather than an error: the pay button on the course page checks them too, and a
 * page that answered with a stack trace to a bookmark would be a worse page than
 * one that says which of the five it is looking at.
 */
export default function CheckoutPage() {
  const { spaceId } = useParams<{ spaceId: string }>();

  return <CheckoutScreen spaceId={spaceId} />;
}

function CheckoutScreen({ spaceId }: { spaceId: string }) {
  const { course, sections, instructors, isLoading, notFound, error } = useCourseView(spaceId);
  const status = useAuthStatus();
  const { enrolled, isLoading: enrollmentLoading } = useEnrollment(spaceId);
  const checkout = useStartCheckout(spaceId);
  const router = useRouter();

  const coursePath = `/courses/${spaceId}`;
  const signedIn = status === 'authenticated';

  /**
   * Whether this reader can actually buy this course.
   *
   * The same three questions the API asks, read here so the intent is not opened
   * for somebody who cannot use one: a course that is listed and has a price, a
   * reader who is signed in — because the buyer is who the enrolment is for — and
   * a reader who is not already in it.
   */
  const paid = isPaid({ priceCents: course?.priceCents ?? 0 });
  const ready = Boolean(course) && paid && signedIn && !enrolled;

  const [session, setSession] = useState<CourseCheckoutResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** Bumped by "Try again", and the only reason an intent is ever asked for twice. */
  const [attempt, setAttempt] = useState(0);

  /**
   * The intent, asked for once when the page knows there is a purchase to make.
   *
   * The ref holds the attempt this page has already opened an intent for, rather
   * than a boolean, because this effect is the one place a second run would be a
   * second intent — and a second row in the payments table for an attempt nobody
   * made. React runs effects twice in development, and the guard is what makes
   * that cost nothing.
   */
  const opened = useRef(-1);
  const startCheckout = checkout.mutateAsync;

  useEffect(() => {
    if (!ready || opened.current === attempt) return;
    opened.current = attempt;

    void startCheckout()
      .then(setSession)
      .catch((cause: unknown) =>
        setFailure(cause instanceof Error ? cause.message : 'Could not open the payment form'),
      );
  }, [ready, attempt, startCheckout]);

  /**
   * Asking for a form again.
   *
   * The intent behind the old one is left where it is — Stripe cancels the ones
   * nobody confirms, and the webhook moves the row to `EXPIRED` when it does — so
   * this is a new attempt rather than a resurrected one.
   */
  function retry() {
    setFailure(null);
    setSession(null);
    setAttempt((n) => n + 1);
  }

  /**
   * Whether the page knows what to say yet.
   *
   * Not on the first paint: the session is restored from storage after the page
   * is alive, so until it is there this page says nothing rather than offering a
   * form to somebody it has not identified.
   */
  const settled = status !== 'configuring' && !(signedIn && enrollmentLoading) && !isLoading;

  const accent = course ? spaceAccentColor(course) : '#6366f1';
  const amountCents = session?.amountCents ?? course?.priceCents ?? 0;
  const currency = session?.currency ?? course?.currency ?? 'usd';
  // A course with no lesson is still worth selling — the author may publish the
  // rest tomorrow — but a sentence counting nothing would read as a mistake.
  const lessonCount = sections.reduce((total, section) => total + section.lessons.length, 0);

  if (isLoading || !settled) return <CheckoutSkeleton />;

  if (notFound) {
    return (
      <Panel
        title="This course is not in the marketplace"
        body="It may have been unpublished by whoever wrote it, or the link may be wrong."
      >
        <Button asChild variant="outline">
          <Link href="/discover">Discover courses</Link>
        </Button>
      </Panel>
    );
  }

  if (error || !course) {
    return (
      <Panel
        title="Could not open the checkout"
        body={error instanceof Error ? error.message : 'This course could not be loaded.'}
      >
        <Button asChild variant="outline">
          <Link href={coursePath}>Back to the course</Link>
        </Button>
      </Panel>
    );
  }

  if (enrolled) {
    return (
      <Panel
        title="You already have this course"
        body="It is in your learning, so there is nothing to pay for. Opening it is free."
      >
        <Button asChild>
          <Link href={coursePath}>Go to the course</Link>
        </Button>
      </Panel>
    );
  }

  if (!signedIn) {
    return (
      <Panel
        title="Sign in to buy this course"
        body="A purchase is tied to an account — it is what the course is added to afterwards. Signing in brings you straight back here."
      >
        <Button asChild>
          <Link href={`/sign-in?next=${encodeURIComponent(`${coursePath}/checkout`)}`}>
            Sign in and pay
          </Link>
        </Button>
      </Panel>
    );
  }

  if (!paid) {
    return (
      <Panel
        title="This course is free"
        body="There is nothing to pay for it — registering from the course page is how you get in."
      >
        <Button asChild>
          <Link href={coursePath}>Go to the course</Link>
        </Button>
      </Panel>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-10">
      <Link
        href={coursePath}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to the course
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <OrderSummary
          title={course.title}
          organizationName={course.organizationName}
          thumbnailUrl={course.thumbnailUrl}
          instructors={instructors}
          lessonCount={lessonCount}
          amountCents={amountCents}
          currency={currency}
          accent={accent}
        />

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="grid gap-4 rounded-2xl border bg-card p-5">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Payment</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatPrice(amountCents, currency)} today, once. No subscription.
              </p>
            </div>

            {failure ? (
              <div className="grid gap-3">
                <p className="text-sm text-destructive">{failure}</p>
                <Button variant="outline" onClick={retry}>
                  Try again
                </Button>
              </div>
            ) : !session ? (
              <p className="inline-flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2Icon className="animate-spin size-4" />
                Opening the payment form…
              </p>
            ) : (
              <CheckoutPaymentForm
                session={session}
                accent={accent}
                onPaid={() => router.replace(`${coursePath}?paid=1`)}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * What is being bought, in the course's own colour.
 *
 * The course page and this one are the same course, so the cover, the title and
 * the instructors are drawn the same way — with the accent the course is drawn in
 * everywhere else. It is the difference between a checkout that belongs to this
 * product and a form bolted onto a catalogue.
 *
 * The total is the *server's* amount rather than the catalog's: the price the
 * intent was opened for is the price Stripe will charge, and a summary that
 * printed the card's own copy of the number could disagree with the charge by a
 * cent after an author edits a price.
 */
function OrderSummary({
  title,
  organizationName,
  thumbnailUrl,
  instructors,
  lessonCount,
  amountCents,
  currency,
  accent,
}: {
  title: string;
  organizationName: string;
  thumbnailUrl?: string | null;
  instructors: PublicInstructor[];
  lessonCount: number;
  amountCents: number;
  currency: string;
  accent: string;
}) {
  return (
    <section className="grid gap-6">
      <div
        className="relative overflow-hidden rounded-3xl border"
        style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}99 100%)` }}
      >
        <div className="flex items-center gap-4 p-6" style={{ color: accentInk(accent) }}>
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt=""
              className="size-16 shrink-0 rounded-2xl border border-white/20 object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.12em] opacity-80">You are buying</p>
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            <p className="mt-1 truncate text-sm opacity-90">from {organizationName}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          What you get
        </h2>

        <ul className="grid gap-3">
          <Included icon={<CirclePlayIcon className="size-4" />}>
            {lessonCount > 0
              ? `All ${lessonCount} lesson${lessonCount === 1 ? '' : 's'}, unlocked the moment the payment lands`
              : 'Every lesson this course publishes, as it is published'}
          </Included>
          <Included icon={<BadgeCheckIcon className="size-4" />}>
            Kept for good — a purchase is not a subscription and does not expire
          </Included>
          <Included icon={<RefreshCcwIcon className="size-4" />}>
            {REFUND_WINDOW_DAYS} days to change your mind, refunded in full from your billing history
          </Included>
        </ul>

        {instructors.length > 0 ? (
          <p className="border-t pt-4 text-sm text-muted-foreground">
            Taught by {instructors.map((instructor) => instructor.name).join(', ')}
          </p>
        ) : null}

        <div className="flex items-baseline justify-between border-t pt-4">
          <span className="text-sm font-medium">Total due today</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatPrice(amountCents, currency)}
          </span>
        </div>
      </div>
    </section>
  );
}

function Included({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * One of the states that is not a checkout.
 *
 * Its own component because they are all the same shape — a sentence and the way
 * out of it — and the reader who arrives at one of them is someone who followed a
 * link to a course they cannot buy right now. Nothing here is an error: each one
 * names what is true and offers the thing they probably wanted.
 */
function Panel({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <ShieldCheckIcon className="size-4 text-muted-foreground" />
      </span>
      <p className="text-base font-medium tracking-tight">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-10">
      <Skeleton className="h-4 w-32" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="grid gap-6">
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}
