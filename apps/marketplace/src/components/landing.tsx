'use client';

import Link from 'next/link';
import {
  ArrowRightIcon,
  CaptionsIcon,
  CheckCircle2Icon,
  CompassIcon,
  GiftIcon,
  MailIcon,
  NotebookPenIcon,
  PlayCircleIcon,
  QuoteIcon,
  Repeat2Icon,
  SparklesIcon,
  StarIcon,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { Reveal } from '@play/ui';
import { cn } from '@ui/lib/utils';
import { FeaturedCourses } from '@/components/landing-featured';

/**
 * The marketplace's front page.
 *
 * Written in the register a front page uses rather than the register an app
 * does: the headline is a claim, the sections between it and the footer are the
 * evidence, and the only two things to press are "Discover courses" and "Sign
 * in". Everything that is a *screen* — the catalog, a course, a lesson — is
 * somewhere else, because a visitor who does not yet know what Play is has no
 * use for a navigation bar's worth of options.
 *
 * It borrows the vocabulary the rest of the site is built to (large radii,
 * hairline edges, translucent bars, sentence case) and adds one thing the app
 * screens do not need: air. Large type, wide margins, one accent, and motion
 * that only ever says "here is the next part".
 *
 * The reviews in `TESTIMONIALS` are written for this page, not collected from
 * anybody. They are placeholders for a product nobody has reviewed yet, and they
 * say what the classroom actually does — which is the one thing that has to stay
 * true when they are replaced with real ones.
 */
export function Landing() {
  return (
    <div className="pb-24">
      <Hero />
      <FeaturedCourses />
      <Steps />
      <FeatureRows />
      <Testimonials />
      <ClosingCta />
    </div>
  );
}

/**
 * The top of the page: one sentence, two buttons, and a picture of the thing.
 *
 * The wash behind it is the marketplace's one accent, blurred until it is closer
 * to light than to colour — present enough to lift the headline off the canvas
 * and quiet enough that nothing on the page looks decorated.
 */
function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-gradient-to-b from-emerald-500/10 via-transparent to-transparent blur-3xl"
      />

      <div className="mx-auto w-full max-w-3xl px-4 pt-20 text-center sm:pt-28">
        <Reveal>
          <p className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            Play Marketplace
          </p>
        </Reveal>

        <Reveal delay={60}>
          <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-7xl">
            Courses that fit the life you already have.
          </h1>
        </Reveal>

        <Reveal delay={120}>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl">
            Written by communities on Play. Watch a lesson, stop in the middle,
            and pick it up tomorrow exactly where you left it.
          </p>
        </Reveal>

        <Reveal delay={180}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="px-6 text-base">
              <Link href="/discover">
                Discover courses
                <ArrowRightIcon />
              </Link>
            </Button>

            <Button asChild size="lg" variant="ghost" className="px-6 text-base">
              <Link href="#how-it-works">How it works</Link>
            </Button>
          </div>
        </Reveal>
      </div>

      <Reveal delay={240} className="mx-auto mt-16 w-full max-w-5xl px-4 sm:mt-20">
        <PlayerPreview />
      </Reveal>
    </section>
  );
}

/**
 * A picture of the classroom, drawn rather than screenshotted.
 *
 * A screenshot of a real lesson on a marketing page is a promise about somebody
 * else's course; this is a drawn one, and it is `aria-hidden` from top to bottom
 * — nothing inside it is focusable or clickable, so a screen reader is told to
 * skip it and nobody can tab into a lesson that is not there.
 *
 * It is worth the markup because it answers the question a front page's words
 * cannot: what is it like to use? Video on the left, the transcript travelling
 * beside it, a progress bar that says "you will not be starting over".
 */
function PlayerPreview() {
  return (
    <div aria-hidden className="relative">
      <div className="pointer-events-none absolute -inset-x-8 -top-8 bottom-4 rounded-full bg-gradient-to-b from-emerald-500/20 to-transparent blur-3xl" />

      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl shadow-black/5 dark:shadow-black/40">
        {/* The one line of chrome a lesson has: where you are. */}
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <p className="ml-2 truncate text-xs text-muted-foreground">
            Introduction to Colour Grading · Lesson 3 of 12
          </p>
        </div>

        <div className="grid lg:grid-cols-3">
          {/* The video, standing in as a coloured rectangle. Two thirds of the
              frame, which is the share a lesson gives it. */}
          <div className="relative aspect-video bg-gradient-to-br from-emerald-500 via-emerald-700 to-zinc-900 lg:col-span-2">
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-background/20 backdrop-blur-md">
                <PlayCircleIcon className="size-7 text-white/90" />
              </span>
            </div>

            <div className="absolute inset-x-6 bottom-6">
              <div className="h-1 overflow-hidden rounded-full bg-white/25">
                <div className="h-full w-1/3 rounded-full bg-white/90" />
              </div>
            </div>
          </div>

          {/* The transcript beside it: said, being said, not yet said. It is the
              one panel on the page that has to look like the product rather than
              describe it. */}
          <div className="grid content-start gap-4 border-t border-border/40 p-6 lg:border-t-0 lg:border-l">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Transcript</p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                <Repeat2Icon className="size-3" />
                Looping
              </span>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground/40">
              Colour grading is not a filter you put on at the end of the edit.
            </p>
            <p className="text-sm leading-relaxed text-foreground">
              It is a decision you make before you ever turn the camera on —
              which is why the grey card matters more than the preset.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground/40">
              Hold it in the first shot of the scene and every shot after it has
              something to agree with.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The three things a reader does here, in the order they do them. */
const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CompassIcon,
    title: 'Discover',
    body: 'Every course a community has published, with its cover, its syllabus, and how many people are already taking it. No account needed to look.',
  },
  {
    icon: CheckCircle2Icon,
    title: 'Register in a click',
    body: 'One button on the course page. An invitation you were already sent is claimed rather than replaced, so you keep the role you were given.',
  },
  {
    icon: PlayCircleIcon,
    title: 'Take it at your pace',
    body: 'Lessons open in the classroom — video, transcript, and your own notes — and your place is kept between one and the next.',
  },
];

function Steps() {
  return (
    <section id="how-it-works" className="mx-auto mt-28 w-full max-w-6xl scroll-mt-20 px-4">
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Three steps, and the first one needs nothing from you.
          </h2>
        </div>
      </Reveal>

      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <Reveal key={step.title} delay={index * 80} className="h-full">
            <div className="flex h-full flex-col rounded-3xl border border-border/60 bg-card p-6">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                <step.icon className="size-4" />
              </span>
              <h3 className="mt-5 text-base font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
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

/** What the classroom does that a video in a browser tab does not. */
const CLASSROOM: Point[] = [
  {
    icon: CaptionsIcon,
    title: 'A transcript that keeps up',
    body: 'The words light as they are said, so you can read ahead when the audio is slow and catch up when it is not.',
  },
  {
    icon: Repeat2Icon,
    title: 'Loops for the part that did not stick',
    body: 'Clip a few seconds and replay them until they do, instead of hunting for the same spot a second time.',
  },
  {
    icon: NotebookPenIcon,
    title: 'Notes filed under the second',
    body: 'What you type sits beside the video and comes back with it the next time you open the lesson.',
  },
];

/** What finishing something is worth here. */
const REWARDS: Point[] = [
  {
    icon: GiftIcon,
    title: 'Something at the end of it',
    body: 'Rewards are handed out for finishing a course, or for reaching a milestone its author set along the way.',
  },
  {
    icon: MailIcon,
    title: 'By email, and in the classroom',
    body: 'The link in the letter opens that course’s rewards page with the code on one line — and it is waiting in the lesson either way.',
  },
  {
    icon: CheckCircle2Icon,
    title: 'Given by hand, too',
    body: 'An instructor can hand a reward to one person by name, with a note saying what it is for.',
  },
];

function FeatureRows() {
  return (
    <section className="mx-auto mt-28 grid w-full max-w-6xl gap-24 px-4 sm:gap-32">
      <FeatureRow
        eyebrow="The classroom"
        title="It remembers better than you do."
        body="A lesson is video, transcript and notes in one window, and the three stay in step. Come back a week later and you are where you stopped, not at the beginning of a playlist."
        points={CLASSROOM}
        visual={<TranscriptVisual />}
      />

      <FeatureRow
        eyebrow="Rewards"
        title="Finish something, get something."
        body="Some courses end with a code worth having — a discount, a follow-up, a gift. It arrives when you earn it, and it stays yours."
        points={REWARDS}
        visual={<RewardVisual />}
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
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <SparklesIcon className="size-3.5" />
          {eyebrow}
        </p>

        <h3 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h3>

        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{body}</p>

        <ul className="mt-8 grid gap-6">
          {points.map((point) => (
            <li key={point.title} className="flex gap-3.5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                <point.icon className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">{point.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {point.body}
                </p>
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

/** The transcript, mid-lesson: what has been said, what is being said, what is next. */
function TranscriptVisual() {
  return (
    <div
      aria-hidden
      className="grid gap-5 rounded-3xl border border-border/60 bg-card p-6 shadow-xl shadow-black/5 dark:shadow-black/30"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Transcript</p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
          <Repeat2Icon className="size-3" />
          12:04 – 12:19
        </span>
      </div>

      <p className="text-base leading-relaxed text-muted-foreground/40">
        The grey card is the cheapest thing in your bag.
      </p>

      <p className="text-lg leading-relaxed font-medium">
        Hold it in the first shot of the scene, and every shot after it has
        something to agree with.
      </p>

      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-2/5 rounded-full bg-foreground/70" />
      </div>

      <p className="text-base leading-relaxed text-muted-foreground/40">
        Without it you are grading by memory, and memory is not consistent.
      </p>
    </div>
  );
}

/** A reward as it lands: who earned it, what for, and the code itself. */
function RewardVisual() {
  return (
    <div
      aria-hidden
      className="grid gap-5 rounded-3xl border border-border/60 bg-card p-6 shadow-xl shadow-black/5 dark:shadow-black/30"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <GiftIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Course complete</p>
          <p className="truncate text-xs text-muted-foreground">
            Introduction to Colour Grading
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/40 px-5 py-4">
        <p className="text-xs text-muted-foreground">Your code</p>
        <p className="mt-1.5 font-mono text-lg tracking-widest">PLAY-9F2K-4R7Q</p>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        20% off the follow-up course, waiting in this course’s rewards tab until
        you use it.
      </p>
    </div>
  );
}

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  /** The monogram's tint, so a wall of them is not a wall of one colour. */
  tint: string;
}

/**
 * The page's one long quote, in the size a quote deserves.
 *
 * Separate from the wall below it rather than first among equals: one sentence
 * read in full at a glance says more about the product than six read in passing.
 */
const LEAD_QUOTE: Testimonial = {
  quote:
    'I have paid for courses before and never opened the second lesson. This one I finished on the train, twenty minutes at a time, over two weeks — and the transcript is why.',
  name: 'Maya Okonkwo',
  role: 'Product designer, Lisbon',
  tint: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

/** Written for this page — see the note on `Landing`. */
const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'The loops are quietly brilliant. I clipped the four minutes on retries and replayed them on the bus until they stuck. No scrubbing around trying to find the bit again.',
    name: 'Daniel Reyes',
    role: 'Backend engineer, Austin',
    tint: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  },
  {
    quote:
      'I registered on my phone between lectures and started the first lesson on the walk home. That was the whole sign-up — no card, no tour, no dashboard to figure out first.',
    name: 'Priya Raghavan',
    role: 'Final-year student, Bangalore',
    tint: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  },
  {
    quote:
      'I type notes next to the video and they are still there a week later, filed under the second I wrote them. That is the part I did not expect to end up relying on.',
    name: 'Yusuf Demir',
    role: 'Career switcher, Berlin',
    tint: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  {
    quote:
      'I study between cuts. Stopping mid-lesson on the laptop and opening the same second on my phone is what made this the course I actually finished.',
    name: 'Hana Kobayashi',
    role: 'Documentary editor, Kyoto',
    tint: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
  {
    quote:
      'I study at 2am after a night shift. It opens quietly instead of blasting sound, and it remembers where I fell asleep. Small things, but they are why I kept going.',
    name: 'Lena Fischer',
    role: 'Nurse, Hamburg',
    tint: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  },
  {
    quote:
      'We hand new hires a course on their first morning. They finish it before their first sprint, and the rewards tab is a friendlier nudge than another reminder email.',
    name: 'Marcus Bell',
    role: 'Team lead, Manchester',
    tint: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  },
];

function Testimonials() {
  return (
    <section className="mx-auto mt-28 w-full max-w-6xl px-4">
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Loved by people with full-time lives.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Which is the hard part: anybody can watch a lesson on a quiet Sunday.
          </p>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <figure className="mx-auto mt-14 max-w-3xl text-center">
          <QuoteIcon className="mx-auto size-6 text-muted-foreground/40" />
          <blockquote className="mt-5 text-2xl leading-snug font-medium tracking-tight sm:text-3xl">
            {LEAD_QUOTE.quote}
          </blockquote>
          <figcaption className="mt-6 flex items-center justify-center gap-3">
            <Monogram name={LEAD_QUOTE.name} tint={LEAD_QUOTE.tint} />
            <div className="text-left">
              <p className="text-sm font-medium">{LEAD_QUOTE.name}</p>
              <p className="text-xs text-muted-foreground">{LEAD_QUOTE.role}</p>
            </div>
          </figcaption>
        </figure>
      </Reveal>

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {TESTIMONIALS.map((testimonial, index) => (
          <Reveal key={testimonial.name} delay={index * 60} className="h-full">
            <QuoteCard testimonial={testimonial} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function QuoteCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <figure className="flex h-full flex-col rounded-3xl border border-border/60 bg-card p-6">
      <Stars />

      <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-foreground/90">
        {testimonial.quote}
      </blockquote>

      <figcaption className="mt-6 flex items-center gap-3 border-t border-border/40 pt-5">
        <Monogram name={testimonial.name} tint={testimonial.tint} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{testimonial.name}</p>
          <p className="truncate text-xs text-muted-foreground">{testimonial.role}</p>
        </div>
      </figcaption>
    </figure>
  );
}

/**
 * Five stars, read out rather than drawn five times.
 *
 * The row is one image to a screen reader — "five out of five" — because the
 * alternative is five identical announcements with nothing between them.
 */
function Stars() {
  return (
    <div role="img" aria-label="Five out of five" className="flex gap-0.5 text-amber-500">
      {Array.from({ length: 5 }).map((_, index) => (
        <StarIcon key={index} className="size-3.5 fill-current" />
      ))}
    </div>
  );
}

/** Two letters, a name too long for a circle, and nothing pretending to be a face. */
function Monogram({ name, tint }: { name: string; tint: string }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        tint,
      )}
    >
      {initials}
    </span>
  );
}

/** The last thing on the page: the same two buttons, said once more. */
function ClosingCta() {
  return (
    <section className="mx-auto mt-28 w-full max-w-6xl px-4">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-emerald-500/15 via-muted/40 to-transparent px-6 py-16 text-center sm:px-16 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Your next evening, well spent.
          </h2>

          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Have a look at what is already published. Reading costs nothing and
            nobody will ask who you are until you register.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="px-6 text-base">
              <Link href="/discover">
                Discover courses
                <ArrowRightIcon />
              </Link>
            </Button>

            <Button asChild size="lg" variant="ghost" className="px-6 text-base">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
