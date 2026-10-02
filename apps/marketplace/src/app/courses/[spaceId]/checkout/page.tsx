'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  BadgeCheckIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CirclePlayIcon,
  GiftIcon,
  Loader2Icon,
  LockIcon,
  RefreshCcwIcon,
  SearchXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useStartCheckout } from '@play/api';
import { useAuthStatus } from '@play/auth';
import { spaceAccentColor } from '@learning/components/space/space-avatar';
import { SpaceTypeBadge } from '@learning/components/space/space-type-badge';
import { Button, PersonAvatar, Skeleton, formatDate, formatPrice, isPaid } from '@play/ui';
import {
  REFUND_WINDOW_DAYS,
  type CatalogCourse,
  type CourseCheckoutResponse,
  type PublicInstructor,
} from '@play/types';
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
 * screen where somebody decides to trust a course with a card number is the wrong
 * place to hand over the brand, so the form is drawn here — with Stripe Elements,
 * which is still Stripe collecting the number inside an iframe this app cannot
 * read. What is different is who chose the fields around it, the course's own
 * picture beside it, the plans that make it affordable, and the colour all of it
 * is drawn in.
 *
 * ## One course, one page, read in two columns
 *
 * **The course's name and its price are the first thing in the right-hand
 * column**, which is where the buying happens: somebody who has already decided
 * reads them and pays, without hunting for what this costs. The picture and
 * everything else they might still be weighing — the description, who teaches it,
 * what they get — are on the left, where a reader looks *before* deciding.
 *
 * The pay button is the last thing in that right column, under the fields it
 * confirms: a checkout arranged the other way round asks somebody to commit
 * before they have read what they are buying.
 *
 * ## No box around any of it
 *
 * This page was a bordered card once, with the picture inset inside it and every
 * section inside that, and the effect was a form squeezed into a frame on a page
 * that has the whole window to work with. So the frame is gone: the picture is
 * the course's own banner at full width, the columns are separated by space
 * rather than by a line, and the spacing is what does the work a border was
 * doing — which is the same thing the course page itself does, one click away.
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
   * a reader who is not already in it. The last one waits for the membership to
   * have been *read* rather than merely not found yet: a plain `!enrolled` is
   * true for the first paint of somebody who owns the course, and an intent
   * opened on that would be a pending row for an attempt nobody made.
   */
  const paid = isPaid({ priceCents: course?.priceCents ?? 0 });
  const ready = Boolean(course) && paid && signedIn && !enrollmentLoading && !enrolled;

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
        icon={<SearchXIcon className="size-4" />}
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
        icon={<TriangleAlertIcon className="size-4" />}
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
        icon={<CheckCircle2Icon className="size-4" />}
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
        icon={<LockIcon className="size-4" />}
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
        icon={<GiftIcon className="size-4" />}
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
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-12 sm:px-6 sm:py-16">
      <Link
        href={coursePath}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to the course
      </Link>

      {/*
        One grid, placed explicitly rather than two stacked columns.

        The reading order and the drawn order are different here and both matter:
        somebody on a phone should meet the course's name, its price and the
        payment before a description they may not want, while the same page on a
        wide screen puts the picture opposite the payment. Two wrapper columns
        would force those to be the same order — the title would arrive after the
        description for a reader using a screen reader — so each block is a child
        of one grid and says where it goes when there is room for two columns.
        Everything is in its natural order below `lg`, which is the order it is
        written in.
      */}
      <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        {/* What it is and what it costs: the top of the right-hand column. */}
        <header className="grid gap-4 lg:col-start-2 lg:row-start-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {course.organizationName}
            </span>
            <SpaceTypeBadge type={course.type} />
          </div>

          <h1 className="text-3xl font-semibold leading-tight tracking-tight">{course.title}</h1>

          <p className="text-2xl tabular-nums text-muted-foreground">
            {formatPrice(amountCents, currency)}
          </p>
        </header>

        {/* The course's own picture, opposite it. */}
        <div className="lg:col-start-1 lg:row-start-1">
          <CoursePicture course={course} accent={accent} />
        </div>

        {course.description ? (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground lg:col-start-1 lg:row-start-2">
            {course.description}
          </p>
        ) : null}

        {instructors.length > 0 ? (
          <div className="lg:col-start-1 lg:row-start-3">
            <TaughtBy instructors={instructors} />
          </div>
        ) : null}

        <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:col-start-1 lg:row-start-4 lg:grid-cols-1">
          <Highlight icon={<CirclePlayIcon className="size-4" />}>
            {lessonCount > 0
              ? `All ${lessonCount} lesson${lessonCount === 1 ? '' : 's'}, open the moment the payment lands`
              : 'Every lesson this course publishes, as it is published'}
          </Highlight>
          <Highlight icon={<BadgeCheckIcon className="size-4" />}>
            Kept for good — a purchase is not a subscription and does not expire
          </Highlight>
          {course.type === 'SCHEDULED' && course.startAt ? (
            <Highlight icon={<CalendarClockIcon className="size-4" />}>
              Starts {formatDate(course.startAt)}
            </Highlight>
          ) : null}
          <Highlight icon={<RefreshCcwIcon className="size-4" />}>
            {REFUND_WINDOW_DAYS} days to change your mind, refunded in full from your billing
            history
          </Highlight>
        </ul>

        {/*
          Paying for it, under the name and the price it is paying for.

          No heading above this: the fields and a button reading "Pay $80" say what
          it is, and a label saying "Payment" over a card form was one more line
          between somebody and the thing they came here to do.
        */}
        <section className="grid gap-8 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-3 lg:row-start-2 lg:self-start">
          {failure ? (
            <div className="grid gap-5">
              <p className="text-sm text-destructive">{failure}</p>
              <Button variant="outline" onClick={retry}>
                Try again
              </Button>
            </div>
          ) : !session ? (
            <div className="grid gap-6">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-11 w-full rounded-full" />
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="animate-spin size-4" />
                Opening the payment form…
              </p>
            </div>
          ) : (
            <CheckoutPaymentForm
              session={session}
              accent={accent}
              onPaid={() => router.replace(`${coursePath}?paid=1`)}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The course, as a picture.
 *
 * Its own cover when its author uploaded one — the same picture the catalog, the
 * discovery grid and the course page draw, at the largest size any screen gives
 * it, because this is where somebody looks hardest at what they are about to buy.
 * With no cover, the accent colour the course is drawn in everywhere else, with
 * its initial in it: a checkout with an empty grey rectangle where the picture
 * goes would look like a missing image, and this looks like the course.
 *
 * **Nothing frames it.** No card around the picture, no border, no inset — a
 * course being bought is a course, and the same banner the course page opens with
 * is the honest thing to draw here: it is the one thing on this page a reader
 * recognizes before they have read a word, and a box drawn around it only makes
 * it smaller.
 */
function CoursePicture({ course, accent }: { course: CatalogCourse; accent: string }) {
  return (
    <div
      className="relative aspect-[16/10] w-full overflow-hidden rounded-3xl sm:aspect-[16/9]"
      style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}66 100%)` }}
    >
      {course.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={course.thumbnailUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span
          className="absolute inset-0 flex items-center justify-center text-7xl font-semibold"
          style={{ color: accentInk(accent) }}
        >
          {course.title.trim()[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </div>
  );
}

/**
 * Who teaches it, as faces.
 *
 * Above what the course contains and below what it is: a name is how somebody
 * decides whether to trust a syllabus, and a face is how they remember it. The
 * picture is the person's own when they have uploaded one, and a silhouette when
 * they have not — which is what `PersonAvatar` is for.
 */
function TaughtBy({ instructors }: { instructors: PublicInstructor[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {instructors.map((instructor) => (
        <Link
          key={instructor.userId}
          href={`/instructors/${encodeURIComponent(instructor.userId)}`}
          className="flex items-center gap-2.5 text-sm transition-colors hover:text-foreground"
        >
          <PersonAvatar name={instructor.name} photoUrl={instructor.photoUrl} size="md" />
          <span className="grid">
            <span className="font-medium">{instructor.name}</span>
            <span className="text-xs text-muted-foreground">Instructor</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** One line of what the purchase includes. */
function Highlight({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
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
 * Its own component because they are all the same shape — a mark, a sentence, and
 * the way out of it — and the reader who arrives at one of them is someone who
 * followed a link to a course they cannot buy right now. Nothing here is an
 * error: each one names what is true and offers the thing they probably wanted,
 * which is why the mark changes with the state rather than there being one
 * apology drawn for all five.
 */
function Panel({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <span className="text-muted-foreground">{icon}</span>
      </span>
      <p className="text-base font-medium tracking-tight">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * The page before it has anything to draw, in the shape it will have.
 *
 * The same banner, the same two columns and the same rhythm the loaded page has,
 * so nothing jumps when the course arrives — a skeleton is a promise about where
 * things will be, and one drawn in a different shape is a page that moves under
 * somebody's eyes.
 */
function CheckoutSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-12 sm:px-6 sm:py-16">
      <Skeleton className="h-4 w-32" />

      <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid gap-4 lg:col-start-2 lg:row-start-1">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-9 w-4/5" />
          <Skeleton className="h-7 w-28" />
        </div>

        <Skeleton className="aspect-[16/10] w-full rounded-3xl sm:aspect-[16/9] lg:col-start-1 lg:row-start-1" />

        <Skeleton className="h-16 w-full lg:col-start-1 lg:row-start-2" />

        <Skeleton className="h-12 w-64 rounded-full lg:col-start-1 lg:row-start-3" />

        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:col-start-1 lg:row-start-4 lg:grid-cols-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>

        <div className="grid gap-8 lg:col-start-2 lg:row-span-3 lg:row-start-2">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
