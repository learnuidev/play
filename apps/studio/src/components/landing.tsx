'use client';

import Link from 'next/link';
import {
  ArrowRightIcon,
  CaptionsIcon,
  ClapperboardIcon,
  GiftIcon,
  ListChecksIcon,
  MailIcon,
  NotebookPenIcon,
  Repeat2Icon,
  SparklesIcon,
  StoreIcon,
  TerminalIcon,
  UploadCloudIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { Reveal } from '@play/ui';
import { Button } from '@ui/components/ui/button';
import { cn } from '@ui/lib/utils';
import { PublicHeader, useStudioEntry } from '@/components/public-header';

/**
 * The studio's front page.
 *
 * The studio never had one. Somebody who signed in was forwarded straight to
 * their first community, which is right for the twentieth visit and useless for
 * the first: a person who has never heard of Play arrived at a sign-in form with
 * no answer to "what is this, and what would I do with it".
 *
 * So this page is written in the register a front page uses rather than the
 * register an app does — the same register the marketplace's front page is
 * written in, which is the only other screen in the product that makes a claim
 * before it shows anything. The headline says what the studio is for, the
 * sections between it and the footer are the evidence, and everything that is a
 * *screen* is one link away: `/home` for people who already have an account,
 * `/docs` for people who would rather read the API than the sales copy.
 *
 * One deliberate absence: there are no testimonials here. The marketplace's
 * reviews are written for it and say so; a front page for the tool somebody uses
 * to build the thing is better served by a picture of the tool.
 */

export function Landing() {
  return (
    <div className="pb-24">
      <PublicHeader />
      <Hero />
      <Steps />
      <FeatureRows />
      <DeveloperBand />
      <ClosingCta />
      <LandingFooter />
    </div>
  );
}

/**
 * The top of the page: one sentence, two buttons, and a picture of the thing.
 *
 * The wash behind it is the page's one piece of colour, blurred until it is
 * closer to light than to colour — present enough to lift the headline off the
 * canvas and quiet enough that nothing on the page looks decorated.
 */
function Hero() {
  const entry = useStudioEntry();

  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-gradient-to-b from-sky-500/10 via-transparent to-transparent blur-3xl"
      />

      <div className="mx-auto w-full max-w-3xl px-4 pt-20 text-center sm:pt-28">
        <Reveal>
          <p className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            Play Studio
          </p>
        </Reveal>

        <Reveal delay={60}>
          <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-7xl">
            Make a course people finish.
          </h1>
        </Reveal>

        <Reveal delay={120}>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl">
            Upload the video, write the lessons, invite the people taking them — and hand
            every one of them a classroom that remembers where they stopped.
          </p>
        </Reveal>

        <Reveal delay={180}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="px-6 text-base">
              <Link href={entry.href}>
                {entry.label}
                <ArrowRightIcon />
              </Link>
            </Button>

            <Button asChild size="lg" variant="ghost" className="px-6 text-base">
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>
        </Reveal>
      </div>

      <Reveal delay={240} className="mx-auto mt-16 w-full max-w-5xl px-4 sm:mt-20">
        <StudioPreview />
      </Reveal>
    </section>
  );
}

/**
 * A picture of the studio, drawn rather than screenshotted.
 *
 * A screenshot of somebody's course is a promise about their work; this is the
 * shape of the work instead — the outline of a course on the left, the lesson
 * being written on the right, and a transcript arriving under it. It is
 * `aria-hidden` from top to bottom: nothing inside is focusable, so nobody can
 * tab into a lesson that does not exist.
 */
function StudioPreview() {
  return (
    <div aria-hidden className="relative">
      <div className="pointer-events-none absolute -inset-x-8 -top-8 bottom-4 rounded-full bg-gradient-to-b from-sky-500/20 to-transparent blur-3xl" />

      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl shadow-black/5 dark:shadow-black/40">
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <p className="ml-2 truncate text-xs text-muted-foreground">
            Introduction to Colour Grading · Draft
          </p>
        </div>

        <div className="grid lg:grid-cols-3">
          {/* The outline: what the course is made of, in the order it is taken. */}
          <div className="border-b border-border/40 p-5 lg:border-b-0 lg:border-r">
            <p className="text-xs text-muted-foreground">Course contents</p>

            <div className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <p className="text-sm font-medium">1 · Why grade at all</p>
                <OutlineRow label="The grey card" state="Ready" />
                <OutlineRow label="Grading before the edit" state="Ready" />
              </div>

              <div className="grid gap-1.5">
                <p className="text-sm font-medium">2 · Matching shots</p>
                <OutlineRow label="Reading a waveform" state="Transcribing" />
                <OutlineRow label="One look, six scenes" state="Draft" />
              </div>
            </div>
          </div>

          {/* The lesson being written: the video, and the words under it. */}
          <div className="lg:col-span-2">
            <div className="relative aspect-video bg-gradient-to-br from-sky-600 via-sky-900 to-zinc-900">
              <div className="absolute inset-x-6 bottom-6">
                <div className="h-1 overflow-hidden rounded-full bg-white/25">
                  <div className="h-full w-2/5 rounded-full bg-white/90" />
                </div>
              </div>
            </div>

            <div className="grid content-start gap-3 border-t border-border/40 p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Transcript</p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs text-sky-700 dark:text-sky-300">
                  <CaptionsIcon className="size-3" />
                  Auto
                </span>
              </div>

              <p className="text-sm leading-relaxed text-muted-foreground/40">
                A waveform is not the picture. It is the numbers behind it.
              </p>
              <p className="text-sm leading-relaxed text-foreground">
                Hold the grey card in the first shot and every shot after it has something to
                agree with.
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground/40">
                Fix the exposure here, then the look is one decision instead of six.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One lesson in the outline: what it is called, and where it has got to. */
function OutlineRow({ label, state }: { label: string; state: string }) {
  const tint =
    state === 'Transcribing'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : 'border-border/60 bg-muted/40 text-muted-foreground';

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/60 px-3 py-2">
      <span className="size-6 shrink-0 rounded-lg bg-muted/60" />
      <p className="min-w-0 flex-1 truncate text-sm">{label}</p>
      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', tint)}>{state}</span>
    </div>
  );
}

/** The three things a creator does here, in the order they do them. */
const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: UploadCloudIcon,
    title: 'Put the video in',
    body: 'Upload it, and the transcript starts writing itself while you get on with the next thing. Edit a line, cut a subtitle, pick the frame that becomes the cover.',
  },
  {
    icon: ListChecksIcon,
    title: 'Write the lessons',
    body: 'A course is sections and the lessons inside them, each with its own notes and files. Reorder by dragging; nothing is published until you say so.',
  },
  {
    icon: UsersIcon,
    title: 'Hand it to people',
    body: 'Invite them by email, or put the course on the marketplace and let them register. Either way they get the classroom, and you get to watch them finish it.',
  },
];

function Steps() {
  return (
    <section id="how-it-works" className="mx-auto mt-28 w-full max-w-6xl scroll-mt-20 px-4">
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Three steps, and the first one is the video.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Everything after it is the part a folder of files cannot do.
          </p>
        </div>
      </Reveal>

      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <Reveal key={step.title} delay={index * 80} className="h-full">
            <div className="flex h-full flex-col rounded-3xl border border-border/60 bg-card p-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                <step.icon className="size-4" />
              </span>
              <h3 className="mt-5 text-base font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

interface Point {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** What the classroom does with the course once somebody is in it. */
const CLASSROOM: Point[] = [
  {
    icon: CaptionsIcon,
    title: 'A transcript that keeps up',
    body: 'The words light as they are said. Somebody who reads faster than you talk can read ahead, and somebody in a quiet room can take the lesson in without sound.',
  },
  {
    icon: Repeat2Icon,
    title: 'Loops for the part that did not stick',
    body: 'Learners clip a few seconds and replay them until they have it, instead of hunting for the same spot a second time.',
  },
  {
    icon: NotebookPenIcon,
    title: 'Notes filed under the second',
    body: 'What they type sits beside the video and comes back with it — so a week later the course opens where they stopped.',
  },
];

/** What happens to a course after it is finished. */
const REACH: Point[] = [
  {
    icon: StoreIcon,
    title: 'Published to the marketplace',
    body: 'One switch puts the course in the catalog with its cover, its syllabus and its price of admission — which is nothing at all, unless you say otherwise.',
  },
  {
    icon: MailIcon,
    title: 'Or handed out by invitation',
    body: 'Invite people by email to the course, or to a cohort inside it. A community can keep several on the go at once, each with its own people.',
  },
  {
    icon: GiftIcon,
    title: 'With something at the end of it',
    body: 'Attach a reward to finishing a course, or to a milestone along the way, and hand it over yourself when somebody earns it by hand.',
  },
];

function FeatureRows() {
  return (
    <section className="mx-auto mt-28 grid w-full max-w-6xl gap-24 px-4 sm:gap-32">
      <FeatureRow
        eyebrow="The classroom"
        title="The course is only half of it."
        body="What people take is the classroom: video, transcript and notes in one window, in step with each other. You write the lessons; it does the remembering."
        points={CLASSROOM}
        visual={<TranscriptVisual />}
      />

      <FeatureRow
        eyebrow="Where it goes"
        title="Published, invited, or both."
        body="A course can be public in the marketplace, private to the people you invited, or both at once — the same lessons either way, with different doors."
        points={REACH}
        visual={<PublishVisual />}
        reverse
      />
    </section>
  );
}

/**
 * One claim and its picture, side by side and mirrored on alternate rows.
 *
 * The mirroring is not decoration: two rows leaning the same way read as a list,
 * while two facing each other read as an argument being made. The text is always
 * readable first on a narrow screen, where the picture comes after it.
 */
function FeatureRow({
  eyebrow,
  title,
  body,
  points,
  visual,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  points: Point[];
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <Reveal className={cn(reverse && 'lg:order-2')}>
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 dark:text-sky-400">
          <SparklesIcon className="size-3.5" />
          {eyebrow}
        </p>

        <h3 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h3>

        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{body}</p>

        <ul className="mt-8 grid gap-6">
          {points.map((point) => (
            <li key={point.title} className="flex gap-3.5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                <point.icon className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">{point.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={80} className={cn(reverse && 'lg:order-1')}>
        {visual}
      </Reveal>
    </div>
  );
}

/** A lesson mid-read: what has been said, what is being said, what is next. */
function TranscriptVisual() {
  return (
    <div
      aria-hidden
      className="grid gap-5 rounded-3xl border border-border/60 bg-card p-6 shadow-xl shadow-black/5 dark:shadow-black/30"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Reading a waveform · 04:12</p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
          <Repeat2Icon className="size-3" />
          Looping 04:12 – 04:28
        </span>
      </div>

      <p className="text-base leading-relaxed text-muted-foreground/40">
        The waveform is the numbers behind the picture.
      </p>

      <p className="text-lg leading-relaxed font-medium">
        Keep the blacks off the floor and the highlights off the ceiling, and the shot has
        somewhere to go in both directions.
      </p>

      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-2/5 rounded-full bg-foreground/70" />
      </div>

      <p className="text-base leading-relaxed text-muted-foreground/40">
        Everything after this is a choice about which way to spend the room you left.
      </p>
    </div>
  );
}

/** A course as it looks once it is out: in the catalog, with people on it. */
function PublishVisual() {
  return (
    <div
      aria-hidden
      className="grid gap-5 rounded-3xl border border-border/60 bg-card p-6 shadow-xl shadow-black/5 dark:shadow-black/30"
    >
      <div className="flex items-start gap-4">
        <span className="size-14 shrink-0 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-900" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Introduction to Colour Grading</p>
          <p className="mt-1 text-xs text-muted-foreground">12 lessons · 2 hours 40 minutes</p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs text-sky-700 dark:text-sky-300">
            <StoreIcon className="size-3" />
            In the marketplace
          </span>
        </div>
      </div>

      <div className="grid gap-2 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground">Taking it</p>
        <div className="flex items-center gap-2">
          <span className="size-6 rounded-full bg-foreground/10" />
          <span className="size-6 rounded-full bg-foreground/15" />
          <span className="size-6 rounded-full bg-foreground/20" />
          <span className="size-6 rounded-full bg-foreground/10" />
          <p className="ml-1 text-xs text-muted-foreground">
            Who is taking it, and how far each of them has got
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-border/60 px-5 py-4">
        <p className="text-xs text-muted-foreground">Reward on completion</p>
        <p className="mt-1.5 font-mono text-lg tracking-widest">PLAY-9F2K-4R7Q</p>
      </div>
    </div>
  );
}

/**
 * The API, in the middle of the marketing.
 *
 * It is here rather than on a page of its own because it is a genuine answer to
 * "what can I do with this that I could not do with a video host": everything a
 * creator publishes is readable from a script, and the reference is one link
 * away. The example is short on purpose — the request line and the header are the
 * whole of the authentication, and the page it points at prints the host.
 */
function DeveloperBand() {
  return (
    <section className="mx-auto mt-28 w-full max-w-6xl px-4">
      <Reveal>
        <div className="grid items-center gap-10 rounded-3xl border border-border/60 bg-muted/40 p-6 sm:p-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 dark:text-sky-400">
              <TerminalIcon className="size-3.5" />
              Built on
            </p>

            <h3 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Or read it from your own code.
            </h3>

            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Everything you publish is reachable over a read-only API — the catalog, the
              syllabus, and each lesson&rsquo;s video, transcript and files. Make a key, send
              one header, and build the classroom you actually wanted.
            </p>

            <Button asChild variant="secondary" className="mt-7">
              <Link href="/docs">
                Read the API reference
                <ArrowRightIcon />
              </Link>
            </Button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
            <p className="border-b border-border/40 px-4 py-2 text-xs text-muted-foreground">
              The whole of the authentication
            </p>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed">{`GET /v1/courses HTTP/1.1
x-api-key: play_sk_9f2c1a4b7d8e0f1a2b3c4d5e6f7a8b9c`}</pre>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** The last thing on the page: the same two buttons, said once more. */
function ClosingCta() {
  const entry = useStudioEntry();

  return (
    <section className="mx-auto mt-28 w-full max-w-6xl px-4">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-sky-500/15 via-muted/40 to-transparent px-6 py-16 text-center sm:px-16 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            The first lesson is the hard one.
          </h2>

          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Upload it, and the rest of the course is a matter of ordering what you already know.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="px-6 text-base">
              <Link href={entry.href}>
                {entry.label}
                <ArrowRightIcon />
              </Link>
            </Button>

            <Button asChild size="lg" variant="ghost" className="px-6 text-base">
              <Link href="/docs">Read the API reference</Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** The mark, what this is, and the two other things worth reading. */
function LandingFooter() {
  return (
    <footer className="mx-auto mt-24 w-full max-w-6xl px-4">
      <div className="flex flex-col gap-6 border-t border-border/40 pt-8 sm:flex-row sm:items-center">
        <p className="flex items-center gap-1.5 text-sm font-medium tracking-tight">
          <ClapperboardIcon className="size-4" />
          Play Studio
        </p>

        <p className="text-sm text-muted-foreground sm:ml-6">
          Courses built here are taken on Play Marketplace, in the same classroom.
        </p>

        <nav aria-label="Play" className="flex flex-wrap items-center gap-4 sm:ml-auto">
          <Link
            href="/docs"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            API reference
          </Link>
          <Link
            href="/sign-in"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
