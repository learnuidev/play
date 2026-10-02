'use client';

import { cn } from '@ui/lib/utils';
import {
  LessonReaderShell,
  type LessonMaterial,
} from '@learning/components/content/lesson-reader';
import type { LessonPanelTab } from '@learning/hooks/use-lesson-tab';

/**
 * A question, as somebody taking the quiz sees it.
 *
 * ## The one thing here with an answer
 *
 * A question is read, and then it answers back — so unlike a lesson's stage this
 * one is drawn as a **card whose edge is the verdict**: plain while nothing has
 * been marked, green where the answer was right, red where it was not. That edge
 * is the whole reason the reading layout ever had a card of its own, and it is
 * carried here rather than in the shell because it is a fact about a question and
 * not about the layout around it.
 *
 * The card is also what keeps a line of text off the edge of the screen. A video
 * can run to the edges — a picture reads fine flush — but a question's prompt and
 * its options are prose, and prose against the window's edge is prose nobody
 * finishes. So the padding that a lesson's view deliberately does not have is
 * here, and it is not an inconsistency: it is the difference between the two
 * things this view exists to state.
 */
export function QuizView({
  question,
  pills,
  verdict = 'pending',
  bar,
  materials,
  activeMaterial,
  onToggleMaterial,
  dockLabel,
  railOpen,
  railTitle,
  onCloseRail,
  rail,
}: {
  /** The question, or whatever the quiz is saying instead: a loading state, a
   *  result, or that there is nothing to answer yet. */
  question: React.ReactNode;
  /** The row of pills under the card: the decisions this question offers. */
  pills: React.ReactNode;
  /** What the edge says: how the question went, or nothing while it is open. */
  verdict?: QuizVerdict;
  /** The bar across the top, already built: see `LessonReaderShell`. */
  bar: React.ReactNode;
  materials: LessonMaterial[];
  activeMaterial: LessonPanelTab | null;
  onToggleMaterial: (value: LessonPanelTab) => void;
  dockLabel: string;
  railOpen: boolean;
  railTitle: string;
  onCloseRail: () => void;
  rail: React.ReactNode;
}) {
  return (
    <LessonReaderShell
      bar={bar}
      materials={materials}
      activeMaterial={activeMaterial}
      onToggleMaterial={onToggleMaterial}
      dockLabel={dockLabel}
      railOpen={railOpen}
      railTitle={railTitle}
      onCloseRail={onCloseRail}
      rail={rail}
    >
      {/* The border is always *there* and only ever changes colour, which is what
          keeps a question from shifting two pixels sideways the moment it is
          marked. */}
      <main
        className={cn(
          'flex min-h-0 flex-1 flex-col rounded-2xl border-2 bg-card transition-colors duration-300 sm:rounded-3xl',
          VERDICT_EDGE[verdict],
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 [scrollbar-width:none] [-ms-overflow-style:none] sm:px-8 sm:py-10 [&::-webkit-scrollbar]:hidden">
          {/* `min-h-full` inside the scroller rather than centring the scroller
              itself: a flex container that scrolls clips the top of anything
              taller than it. */}
          <div className="flex min-h-full flex-col items-center justify-center">{question}</div>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center justify-center gap-2 px-5 pt-4 pb-5">
          {pills}
        </div>
      </main>
    </LessonReaderShell>
  );
}

/** What a question's edge can say. */
export type QuizVerdict = 'pending' | 'right' | 'wrong';

/**
 * The colour of that edge, one entry per state.
 *
 * Grey while there is nothing to say — and grey rather than absent, so the card
 * keeps its size and a marked question does not move. Green and red are the two
 * answers a question has, and they are the only place on this screen that either
 * colour means anything.
 */
const VERDICT_EDGE: Record<QuizVerdict, string> = {
  pending: 'border-border/60',
  right: 'border-emerald-600/40',
  wrong: 'border-destructive/40',
};
