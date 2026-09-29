'use client';

import Link from 'next/link';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import { ThemeToggle } from '@ui/components/theme-toggle';
import type { LessonPanelTab } from '@learning/hooks/use-lesson-tab';

/**
 * The reading layout — the classroom arranged the way `skld-app` arranges its
 * lesson player, because that is a lesson page this product has already decided
 * it likes.
 *
 * One frame, and **both** kinds of content draw themselves in it: a lesson puts
 * its video in the card and a quiz puts one question there, and neither has to
 * know how a bar, a card, a dock or a rail is put together. `LessonReaderFrame`
 * is the arrangement; everything above it is one of the four pieces it places.
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────┐
 * │ ✕   ‹─── progress, an arrow each side ───›   ●●○●●  12   ☾   │  LessonNavBar
 * ├───────────────────────────────────────────┬───┬──────────────┤
 * │ ┌ card ──────────────────────────────────┐ │ ☰ │ ┌ rail ────┐ │
 * │ │   what this is, in the middle of it    │ │ 📝 │ │          │ │
 * │ │                                        │ │ 📄 │ │          │ │
 * │ ├────────────────────────────────────────┤ │ 🔁 │ │          │ │
 * │ │            the one decision            │ │ 💬 │ │          │ │
 * │ └────────────────────────────────────────┘ │   │ └──────────┘ │
 * └───────────────────────────────────────────┴───┴──────────────┘
 *                                               LessonDock  LessonRail
 * ```
 *
 * The dock is the one piece skld does not have, because skld's rail holds one
 * thing and opens from a pill on the card. A lesson here holds five or six, and
 * a row of pills per material was a row of pills that grew with the material —
 * so they are stacked as icons beside the card instead, always in the same
 * place, and the rail opens to the right of them. A quiz draws the same dock
 * with what a quiz has, which is the contents of the course and its discussion.
 *
 * Nothing here reads the API: every value and every handler is the caller's,
 * passed in. That is what keeps a lesson and a quiz in one frame rather than two
 * pages that have to be kept in step.
 */

/**
 * Which of the lessons' tabs is showing.
 *
 * The hook that remembers the tab owns the union — it is what has to hand one
 * back — so this is a re-export rather than a second list that could drift.
 */
export type { LessonPanelTab };

/** One thing the frame can show: a dock icon, and what opening it shows. */
export interface LessonMaterial {
  value: LessonPanelTab;
  label: string;
  /** What opening it shows, in a sentence — the icon's own words. */
  hint: string;
  icon: React.ReactNode;
}

/** One lesson of the course, and whether this reader has finished it. */
export interface LessonMark {
  contentId: string;
  done: boolean;
}

/** What the bar's middle draws: how far through, and what through. */
export interface LessonProgress {
  done: number;
  total: number;
  /** What the bar is progress through — "Course progress", "Quiz progress". */
  label: string;
  /** The same fact read out: "3 of 8 lessons done". */
  text: string;
}

/** The count on the bar's far side, and how it is read out. */
export interface LessonTally {
  count: number;
  /** The tooltip, which carries what the screen reader cannot infer. */
  title: string;
  /** What follows the number when it is read aloud. */
  srLabel: string;
}

/** The bar's two arrows, when the thing on screen can be stepped through. */
export interface LessonArrows {
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled: boolean;
  nextDisabled: boolean;
}

/**
 * A step back, or a step on.
 *
 * skld steps a lesson's blocks with these and a quiz's questions with them; a
 * Play lesson has no blocks, so the same two buttons walk the *course* — which
 * is the same act in the words this product has for it. They stay out of the way
 * until the reader reaches for the bar, and on a touch screen, where there is no
 * hover to reveal them, they are simply always there.
 */
function LessonArrow({
  direction,
  disabled,
  onClick,
  label,
}: {
  direction: 'previous' | 'next';
  disabled: boolean;
  onClick: () => void;
  /** What a step is here: a lesson, or a question. */
  label: string;
}) {
  const Icon = direction === 'previous' ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <button
      type="button"
      aria-label={direction === 'previous' ? `Previous ${label}` : `Next ${label}`}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground transition-[opacity,color,background-color] duration-200',
        'hover:bg-muted hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-0',
        'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
        'focus-visible:pointer-events-auto focus-visible:opacity-100',
        '[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/**
 * The bar across the top of a lesson or a quiz.
 *
 * The way out, then how far through the reader is, then what they have done so
 * far, then the theme. What the bar is progress through is the caller's: a
 * course, for a lesson — a bar for a single video would be a bar that fills once
 * — and the questions, for a quiz, which is the sequence a reader is actually
 * working through there.
 *
 * The dots are the lessons of a course, one each, and only a lesson draws them:
 * a quiz is one thing to sit, and its questions already have the bar.
 */
export function LessonNavBar({
  exitHref,
  exitLabel,
  exitTitle,
  progress,
  stepLabel,
  marks,
  currentId,
  tally,
  arrows,
}: {
  /** The way out: the course this belongs to. */
  exitHref: string;
  /** What leaving does, for a reader who cannot see where the ✕ goes. */
  exitLabel: string;
  exitTitle: string;
  progress: LessonProgress;
  /** What the arrows step through: "lesson", "question". */
  stepLabel: string;
  marks?: LessonMark[];
  /** The dot of the thing on screen, which is marked out. */
  currentId?: string;
  tally?: LessonTally;
  arrows?: LessonArrows;
}) {
  const { done, total, label, text } = progress;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-2 sm:h-16 sm:gap-6 sm:px-8">
      <Link
        href={exitHref}
        aria-label={exitLabel}
        title={exitTitle}
        // `foreground/5` rather than `muted`: this button sits on the shell
        // itself, and in the light theme the shell *is* `muted` — a hover that
        // changes nothing is a button that looks broken.
        className="flex size-12 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <XIcon className="size-4" />
      </Link>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-4">
        {/* The bar and its two arrows share one hover target, so reaching for
            the bar is what brings them out. */}
        <div className="group flex w-full min-w-0 max-w-[648px] items-center gap-1">
          {arrows && (
            <LessonArrow
              direction="previous"
              disabled={arrows.previousDisabled}
              onClick={arrows.onPrevious}
              label={stepLabel}
            />
          )}

          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-valuetext={text}
            className="h-3 w-full min-w-0 overflow-hidden rounded-full bg-muted"
          >
            {/* Ink rather than green. The bar says where the reader is, which is
                not a verdict on anything — and the green is spent on the marks
                that are: the dots, the sparkle and a marked question's frame.
                It is also the bar the marketplace already draws for a course
                (`components/course-progress`), so the same fact is the same
                colour in both places. */}
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>

          {arrows && (
            <LessonArrow
              direction="next"
              disabled={arrows.nextDisabled}
              onClick={arrows.onNext}
              label={stepLabel}
            />
          )}
        </div>

        {marks && marks.length > 0 ? (
          // One dot per lesson, read out as a tally: the dots themselves are a
          // picture of it, so the label carries the count.
          <div
            role="img"
            aria-label={`Course: ${marks.filter((mark) => mark.done).length} of ${marks.length} lessons done`}
            className="hidden shrink-0 items-center gap-1.5 lg:flex"
          >
            {marks.map((mark) => (
              <span
                key={mark.contentId}
                className={cn(
                  'h-3 w-4 rounded-full transition-colors',
                  mark.done ? 'bg-emerald-500' : 'bg-muted',
                  mark.contentId === currentId && 'ring-2 ring-foreground/30',
                )}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {tally && (
          <span
            className="hidden items-center gap-1.5 text-base font-medium text-muted-foreground sm:flex"
            title={tally.title}
          >
            <SparklesIcon className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {/* `min-w-5` so a two-digit count cannot widen the bar's row and
                nudge the bar itself: the tally is what moves when a learner
                checks an answer, and the bar beside it should hold still. */}
            <span className="inline-block min-w-5 text-right tabular-nums">
              {tally.count}
              <span className="sr-only"> {tally.srLabel}</span>
            </span>
          </span>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

/**
 * The dock: everything the frame can show, stacked down the right-hand side.
 *
 * Vertical beside the card and a row of icons under it where there is no side to
 * put a column on — the same buttons, turned by a media query, so nothing about
 * which material is open changes with the shape of the window.
 *
 * The icon for what is already open is the one that puts it away, so the dock is
 * the whole of the rail's on/off state rather than a control somewhere else that
 * the icons then have to agree with.
 *
 * It is drawn even with nothing in it, which is what the reading layout passes
 * while a lesson is still loading: the box is the same width with five icons in
 * it as with none, so a dock that arrived with the content would take that width
 * off the card the moment it turned up.
 */
function LessonDock({
  items,
  active,
  onToggle,
  label,
  className,
}: {
  items: LessonMaterial[];
  /** The material the rail is open on, or nothing while it is away. */
  active: LessonPanelTab | null;
  onToggle: (value: LessonPanelTab) => void;
  /** What the group of buttons is, for a reader who cannot see the icons. */
  label: string;
  /** Where it sits in the row, which is the frame's decision and not its own. */
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex shrink-0 flex-col items-center justify-center gap-1 rounded-full border border-border/60 bg-card p-1',
        className,
      )}
    >
      {items.map((item) => {
        const open = active === item.value;
        return (
          <button
            key={item.value}
            type="button"
            aria-label={item.label}
            aria-pressed={open}
            title={item.hint}
            onClick={() => onToggle(item.value)}
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors',
              open
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The rail: the material, off the screen until the dock asks for it.
 *
 * A column at the right-hand edge on a wide screen and a panel under the dock on
 * a narrow one, which is the shape skld uses for the same two cases — with the
 * size animated by a width and a height transition rather than by framer-motion.
 *
 * Closed it is `invisible`, not merely zero-sized: a panel shrunk to nothing
 * still holds its buttons in the tab order, and a keyboard reader would walk
 * into a panel they cannot see. `visibility` flips in one step at the end of the
 * slide, which is exactly when the content should stop being reachable.
 */
function LessonRail({
  open,
  title,
  onClose,
  className,
  children,
}: {
  open: boolean;
  /** What the rail is showing, in words: it is the dock's icons said aloud. */
  title: string;
  onClose: () => void;
  /** Where it sits in the row, which is the frame's decision and not its own. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className={cn(
        'shrink-0 overflow-hidden transition-[width,height] duration-300 ease-out motion-reduce:transition-none',
        className,
        open ? 'visible h-[45svh] lg:h-full lg:w-[380px]' : 'invisible h-0 lg:h-full lg:w-0',
      )}
    >
      {/* The inner box keeps the rail's real size whatever the slot is doing,
          which is what stops its contents reflowing their way through the
          opening animation. */}
      <div className="flex h-full min-h-0 w-full flex-col rounded-2xl border border-border/60 bg-card sm:rounded-3xl lg:w-[380px]">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-2">
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close this panel"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {children}
      </div>
    </aside>
  );
}

/**
 * What the card's frame is made of, and when it says anything.
 *
 * A border is grey by default and stays grey — it is the frame the content sits
 * in, and a frame that changes colour is a frame the eye goes to instead of the
 * picture inside it. A *video* in particular has nothing to be right or wrong
 * about, so its frame never answers at all: whether a lesson is finished is said
 * once, by the pill under it, and a second green answer around the picture is
 * the same fact shouted twice.
 *
 * A question is the one thing here with an answer, so a marked one tints its own
 * frame — skld's verdict border, which is the whole reason the frame has states
 * at all.
 */
export type LessonCardVerdict = 'pending' | 'right' | 'wrong';

/** What the card's border says, one entry per state the frame knows. */
const CARD_BORDER: Record<LessonCardVerdict, string> = {
  pending: 'border-border/60',
  right: 'border-emerald-600/40',
  wrong: 'border-destructive/40',
};

/**
 * The reading layout itself: one screen, and nothing on it scrolls as a whole.
 *
 * **The dock is pinned to the right-hand edge, and it is the same column at every
 * width.** That is the arrangement: the buttons are the one part of the screen
 * that never moves — not when a panel opens beside them, not when the window
 * narrows, not when the content under them changes — so they are taken out of the
 * row entirely and hung down the right of it, and the row keeps a strip of its own
 * width clear for them.
 *
 * What is *in* the row is therefore only the card and the rail: side by side on a
 * wide screen, stacked with the rail under the card on a narrow one, which is the
 * shape a phone has room for. The strip stays reserved at both widths, so the
 * buttons have the same home on a laptop and on a phone.
 *
 * **The shell behind all of it is grey, in both themes.** A lesson is a card on a
 * canvas rather than a page: the video, the rail and the dock are all `bg-card`,
 * and a white card with a hairline edge on a white page is a rectangle rather
 * than a thing lifted off the page. In the dark theme the canvas is already the
 * darkest surface there is, so it stays exactly as it was — what changes is only
 * the light one, where the canvas and the card were the same white.
 */
export function LessonReaderFrame({
  bar,
  cardState = 'pending',
  card,
  materials,
  activeMaterial,
  onToggleMaterial,
  dockLabel,
  railOpen,
  railTitle,
  onCloseRail,
  rail,
  footer,
}: {
  /** The bar across the top, already built: a lesson's or a quiz's. */
  bar: React.ReactNode;
  /** What the card's border says: pending, done, or how a question went. */
  cardState?: LessonCardVerdict;
  card: React.ReactNode;
  materials: LessonMaterial[];
  activeMaterial: LessonPanelTab | null;
  onToggleMaterial: (value: LessonPanelTab) => void;
  /** What the stack of icons is, for a reader who cannot see them. */
  dockLabel: string;
  railOpen: boolean;
  railTitle: string;
  onCloseRail: () => void;
  rail: React.ReactNode;
  /** The row of pills under the card: the decisions this screen offers. */
  footer: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-muted dark:bg-background">
      {bar}

      {/* `pr-16` is the dock's strip: the row's own padding on the left, and room
          for the column of buttons on the right, at every width. */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-3 pb-3 pl-3 pr-16 sm:gap-4 sm:pb-8 sm:pl-8 lg:flex-row">
        <main
          className={cn(
            'flex min-h-0 flex-1 flex-col rounded-2xl border-2 bg-card transition-colors duration-300 sm:rounded-3xl',
            CARD_BORDER[cardState],
          )}
        >
          <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-6 [scrollbar-width:none] [-ms-overflow-style:none] sm:px-8 sm:py-10 [&::-webkit-scrollbar]:hidden">
            {/* `min-h-full` inside the scroller rather than centring the scroller
                itself: a flex container that scrolls clips the top of anything
                taller than it. */}
            <div className="flex min-h-full flex-col items-center justify-center">{card}</div>
          </div>

          <div className="flex w-full shrink-0 flex-wrap items-center justify-center gap-2 px-5 pt-4 pb-5">
            {footer}
          </div>
        </main>

        <LessonRail open={railOpen} title={railTitle} onClose={onCloseRail}>
          {rail}
        </LessonRail>

        {/* Out of the row and against its right edge, centred on the lesson
            rather than on the window: the bar above is not something the
            buttons belong beside. */}
        <LessonDock
          items={materials}
          active={activeMaterial}
          onToggle={onToggleMaterial}
          label={dockLabel}
          className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-3"
        />
      </div>
    </div>
  );
}

/**
 * The screen's one decision, as the footer's last pill.
 *
 * **It is 12rem wide, on every screen that has one.** "Complete lesson", "Next",
 * "Hand in" and "Try again" are the same button in the same place saying
 * different things, and a reader who steps from a lesson to the quiz beside it
 * should not watch the thing they are about to press change size. Twelve rems is
 * skld's proportion — its primary pill takes what is left of a 367px row, which
 * lands at about this — and it is a decision rather than a leftover: the pill was
 * stretching to fill `max-w-2xl` before, which made a button the width of a
 * paragraph. `max-w-full` is what keeps it honest on a card narrower than that.
 *
 * It looks the same when the lesson is already finished. The pill filled with
 * green was a second answer to a question the pill already answers in words —
 * "Completed" against "Complete lesson" — and it made the one control on the
 * screen change colour for a reason the reader cannot act on. A button that says
 * what it does and looks the same every time is the point.
 */
export function LessonPrimaryPill({
  children,
  onClick,
  disabled = false,
  busy = false,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
}) {
  return (
    <Button
      size="lg"
      className={cn('h-12 w-48 max-w-full gap-1.5 rounded-full px-6 text-base')}
      disabled={disabled || busy}
      title={title}
      onClick={onClick}
    >
      {busy ? <Loader2Icon className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

/** The quieter pill beside it: a step back, a second way on. */
export function LessonSecondaryPill({
  children,
  onClick,
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      className="h-12 min-w-24 shrink-0 gap-1.5 rounded-full px-6 text-base"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
