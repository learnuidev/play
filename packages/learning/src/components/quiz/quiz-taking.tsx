'use client';

import { useMemo, useState } from 'react';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HelpCircleIcon,
  LightbulbIcon,
  MessagesSquareIcon,
  ListTreeIcon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useViewerId } from '@auth/hooks/use-viewer';
import { useLearningRoutes } from '@learning/lib/learning-routes';
import { CourseContents } from '@learning/components/content/course-contents';
import { ContentComments } from '@learning/components/content/content-comments';
import {
  LessonNavBar,
  LessonPrimaryPill,
  LessonSecondaryPill,
  type LessonMaterial,
} from '@learning/components/content/lesson-reader';
import { QuizView } from '@learning/components/quiz/quiz-view';
import type { LessonPanelTab } from '@learning/hooks/use-lesson-tab';
import { useQueryClient } from '@tanstack/react-query';
import {
  quizPaperKeys,
  useCheckQuizAnswer,
  useQuizPaper,
  useSubmitQuizAttempt,
} from '@api/modules/question/question.queries';
import type { QuizAttempt, QuizAttemptAnswer, QuizPaperQuestion } from '@play/types';

/**
 * A quiz, as the person taking it sees it.
 *
 * The other half of `QuizPanel`: an author is handed the questions *with* the
 * answer key and edits them, and a learner is handed the same questions without
 * it and answers them.
 *
 * **It is drawn in the classroom's reading shell.** That shell is the bar, the
 * dock and the rail; `QuizView` is what a question puts in the middle of it — a
 * card with the verdict on its edge, which is what a quiz in `skld-app` is: a
 * block on the card a lesson is read beside, at the same size, with the same row
 * of pills under it. A learner moving from a lesson to the quiz beside it is
 * moving to the next thing in the course, not to a different product.
 *
 * Four rules it is built on:
 *
 * - **One question at a time.** The whole quiz is never on screen. A reader
 *   answers, steps on, and can step back; the bar carries how many are answered,
 *   and the card carries the one in hand — which is also what lets the card's
 *   border answer them per question, green or red, the way skld's does.
 * - **The answers are never here.** The paper arrives without them, and what a
 *   question's right answer was comes back only after it has been handed in —
 *   attached to the attempt, as what was true at the time. Nothing on this page
 *   could mark a question, and that is deliberate.
 * - **A question nobody has verified is not asked.** The API holds those back
 *   and counts them, so this page can say so rather than quietly showing a
 *   shorter quiz; a machine's draft must never mark anybody.
 * - **Handing in is the learner's own "I have had my go".** It finishes the quiz
 *   — the completion and the course's rewards are written by the same request —
 *   and the score is a record, not a pass mark. A learner who scored nothing has
 *   still finished it, and can sit it again.
 *
 * What is on screen is decided by the caller's own attempts: the newest result
 * if there is one, the paper if there is not, and the paper again while they are
 * retaking.
 */
export function QuizTaking({
  contentId,
  spaceId,
  title,
}: {
  contentId: string;
  spaceId: string;
  /** The quiz's own name, which the dock's rail and the exit link speak of. */
  title: string;
}) {
  const routes = useLearningRoutes();
  const viewerId = useViewerId();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuizPaper(contentId);
  const submit = useSubmitQuizAttempt(contentId, spaceId);

  /** The option chosen for each question. A question absent from it is unanswered. */
  const [choices, setChoices] = useState<Record<string, string>>({});

  /**
   * What a check said, per question.
   *
   * Kept for the sitting rather than for the question on screen, because
   * stepping back onto a question that was already checked must show what it
   * said — a verdict that vanished when the learner moved on would make the
   * check button a peek rather than an answer.
   *
   * Changing the answer clears it: the verdict was about the option that was
   * chosen then, and leaving it up beside a different one would be the screen
   * telling the learner they are right when they are not.
   */
  const [checked, setChecked] = useState<
    Record<string, { correct: boolean; correctOptionIds: string[]; explanation?: string }>
  >({});

  /**
   * The questions the learner has finished with: checked, and stepped on from.
   *
   * This — not "has an option picked" — is what the bar counts, because a bar is
   * a picture of progress and picking an option is not progress, it is the first
   * half of an answer. A question is done when the API has told the learner where
   * they stand and they have moved on from it; changing the answer afterwards
   * makes it an open question again, and the bar says so.
   */
  const [settled, setSettled] = useState<Record<string, true>>({});
  const check = useCheckQuizAnswer(contentId);

  /** Which question is in hand, and which of the two things is in the rail. */
  const [at, setAt] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [material, setMaterial] = useState<LessonPanelTab>('course');

  /**
   * Whether they are answering rather than reading a result.
   *
   * Only ever set by the learner: the newest attempt is what a page opens on,
   * because somebody coming back to a quiz they have sat is far more often
   * checking their score than starting again.
   */
  const [retaking, setRetaking] = useState(false);

  const questions = data?.questions ?? [];
  const attempts = data?.attempts ?? [];

  /**
   * The result being read, if any: the attempt just handed in, or the newest one
   * on record — unless they are answering again, when there is none.
   */
  const result: QuizAttempt | undefined = retaking
    ? undefined
    : submit.data?.attempt ?? data?.lastAttempt;

  /** What the card is showing: the marked answer, or the question to answer. */
  const marked: QuizAttemptAnswer | undefined = result?.answers[at];
  const question: QuizPaperQuestion | undefined = questions[at];
  const total = result ? result.questionCount : questions.length;
  const last = at >= total - 1;

  /** What the question on the card says so far: what was picked, and its verdict. */
  const chosen = question ? choices[question.questionId] : undefined;
  const verdict = question ? checked[question.questionId] : undefined;

  /**
   * How many of the checks came back right, and how many were taken.
   *
   * The bar counts the sitting — answered, or right once it is handed in — while
   * the tally beside it counts what the checks have said, so a learner working
   * their way through has a running score without the bar pretending the quiz is
   * over.
   */
  const checkedRight = Object.values(checked).filter((entry) => entry.correct).length;

  const answered = questions.filter((entry) => choices[entry.questionId] !== undefined).length;

  /** What the dock offers a quiz: where this sits in the course, and its talk. */
  const materials = useMemo<LessonMaterial[]>(
    () => [
      {
        value: 'course',
        label: 'Contents',
        hint: 'Every lesson in this course, in order — this quiz is marked among them.',
        icon: <ListTreeIcon />,
      },
      {
        value: 'discussion',
        label: 'Discussion',
        hint: 'What everybody taking this quiz has said about it.',
        icon: <MessagesSquareIcon />,
      },
    ],
    [],
  );

  function toggleMaterial(value: LessonPanelTab) {
    if (railOpen && material === value) {
      setRailOpen(false);
      return;
    }
    setMaterial(value);
    setRailOpen(true);
  }

  function choose(questionId: string, optionId: string) {
    setChoices((previous) => ({ ...previous, [questionId]: optionId }));
    // A different answer is a different question to the one that was checked and
    // stepped past, so both facts about it go: the verdict, and the mark the bar
    // was counting.
    setChecked((previous) => {
      if (!(questionId in previous)) return previous;
      const next = { ...previous };
      delete next[questionId];
      return next;
    });
    setSettled((previous) => {
      if (!(questionId in previous)) return previous;
      const next = { ...previous };
      delete next[questionId];
      return next;
    });
  }

  /**
   * Asking the server whether this one is right.
   *
   * The verdict is keyed by the question rather than held for the screen, so it
   * survives stepping away and back; a failure says so and leaves the question
   * answerable instead of pretending anything was checked.
   */
  async function askToCheck(entry: QuizPaperQuestion) {
    const optionId = choices[entry.questionId];
    if (optionId === undefined) return;

    try {
      const verdict = await check.mutateAsync({ questionId: entry.questionId, optionId });
      setChecked((previous) => ({
        ...previous,
        [entry.questionId]: {
          correct: verdict.correct,
          correctOptionIds: verdict.correctOptionIds,
          ...(verdict.explanation ? { explanation: verdict.explanation } : {}),
        },
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not check that answer');
    }
  }

  /**
   * Moving to another question, which is also what finishes the one in hand.
   *
   * Stepping *on* from a question that has been checked settles it — that is the
   * moment it is behind the learner — and stepping back does not unsettle
   * anything: going to look at an earlier answer is not unanswering it.
   */
  function step(to: number) {
    const landing = Math.min(Math.max(0, to), Math.max(0, total - 1));
    if (landing > at && question && checked[question.questionId]) {
      setSettled((previous) => ({ ...previous, [question.questionId]: true }));
    }
    setAt(landing);
  }

  async function handIn() {
    try {
      const { attempt } = await submit.mutateAsync({
        answers: questions
          .filter((entry) => choices[entry.questionId] !== undefined)
          .map((entry) => ({
            questionId: entry.questionId,
            optionId: choices[entry.questionId],
          })),
        // The hand this page was dealt, so the attempt records the options in
        // the order they were answered rather than the order they were written.
        order: Object.fromEntries(
          questions.map((entry) => [entry.questionId, entry.options.map((option) => option.id)]),
        ),
      });

      setRetaking(false);
      // Handing in ends the sitting, so the question in hand is behind the
      // learner as much as one stepped past.
      if (question && checked[question.questionId]) {
        setSettled((previous) => ({ ...previous, [question.questionId]: true }));
      }
      toast.success(`You scored ${attempt.score}%`, {
        description: `${attempt.correctCount} of ${attempt.questionCount} right. The quiz is finished either way — you can sit it again.`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not hand in your answers');
    }
  }

  /**
   * The frame is the outermost thing, in every state.
   *
   * That is not tidiness: a quiz that arrived as a spinner and then grew a bar,
   * a card and a dock would move everything on the page the moment it loaded,
   * and the shell is the part of the screen a reader is not looking at while
   * they wait. So the bar, the card, the dock and the rail are drawn at their
   * real size from the first paint, and only what is *inside* the card changes —
   * a skeleton, a refusal, an empty state, a question, or a marked one.
   */
  const card = isError ? (
    <p className="text-sm text-destructive">
      {error instanceof Error ? error.message : 'Failed to load this quiz'}
    </p>
  ) : isLoading || !data ? (
    <div className="grid w-full max-w-3xl gap-4">
      <Skeleton className="mx-auto h-7 w-3/4 rounded-full" />
      <Skeleton className="h-14 rounded-2xl" />
      <Skeleton className="h-14 rounded-2xl" />
      <Skeleton className="h-14 rounded-2xl" />
    </div>
  ) : total === 0 ? (
    <NothingToAnswer heldBack={data.heldBack} attempt={data.lastAttempt} />
  ) : marked ? (
    <MarkedQuestion
      answer={marked}
      index={at}
      total={total}
      dropped={droppedAnswers(result, choices)}
    />
  ) : question ? (
    <PaperQuestion
      question={question}
      index={at}
      total={total}
      chosen={chosen}
      verdict={verdict}
      onChoose={(optionId) => choose(question.questionId, optionId)}
    />
  ) : null;

  if (isError || isLoading || !data || total === 0) {
    return (
      <QuizView
        bar={
          <LessonNavBar
            exitHref={routes.course(spaceId)}
            exitLabel="Leave the quiz, back to the course"
            exitTitle="Back to the course"
            progress={{ done: 0, total: 0, label: 'Quiz progress', text: 'Nothing to answer yet' }}
            stepLabel="question"
          />
        }
        question={card}
        materials={materials}
        activeMaterial={railOpen ? material : null}
        onToggleMaterial={toggleMaterial}
        dockLabel="What the quiz carries"
        railOpen={railOpen}
        railTitle={material === 'course' ? 'Contents' : 'Discussion'}
        onCloseRail={() => setRailOpen(false)}
        rail={
          <QuizRail material={material} contentId={contentId} spaceId={spaceId} viewerId={viewerId} />
        }
        // The pill that is about to be there, at the size it will be: a footer
        // that grew by a button when the quiz arrived would take those 48px out
        // of the card, which is the question moving before anybody touched it.
        pills={<Skeleton className="h-12 w-48 max-w-full rounded-full" />}
      />
    );
  }

  /**
   * What the bar counts depends on which half of the quiz this is: answers given
   * while it is being sat, and questions got right once it has been handed in.
   * Either way it is the same bar, and the same bar in a lesson counts lessons.
   */
  const settledCount = Object.keys(settled).length;
  const barDone = result ? result.correctCount : settledCount;
  const barText = result
    ? `${result.correctCount} of ${result.questionCount} right`
    : `${settledCount} of ${questions.length} done`;
  const tallyTitle = result
    ? `${result.correctCount} of ${result.questionCount} right`
    : `${checkedRight} right so far`;
  const tallyCount = result ? result.correctCount : checkedRight;

  return (
    <QuizView
      bar={
        <LessonNavBar
          exitHref={routes.course(spaceId)}
          exitLabel="Leave the quiz, back to the course"
          exitTitle="Back to the course"
          progress={{ done: barDone, total, label: 'Quiz progress', text: barText }}
          stepLabel="question"
          tally={{ count: tallyCount, title: tallyTitle, srLabel: result ? 'right' : 'right so far' }}
          arrows={{
            onPrevious: () => step(at - 1),
            onNext: () => step(at + 1),
            previousDisabled: at === 0,
            nextDisabled: last,
          }}
        />
      }
      // The card answers per question, which is the verdict edge: green where it
      // went right, red where it did not, plain while it is unanswered.
      verdict={
        marked ? (marked.correct ? 'right' : 'wrong') : verdict ? (verdict.correct ? 'right' : 'wrong') : 'pending'
      }
      question={card}
      materials={materials}
      activeMaterial={railOpen ? material : null}
      onToggleMaterial={toggleMaterial}
      dockLabel="What the quiz carries"
      railOpen={railOpen}
      railTitle={material === 'course' ? 'Contents' : 'Discussion'}
      onCloseRail={() => setRailOpen(false)}
      rail={
        <QuizRail material={material} contentId={contentId} spaceId={spaceId} viewerId={viewerId} />
      }
      pills={
        <>
          <LessonSecondaryPill
            disabled={at === 0}
            title="The question before this one"
            onClick={() => step(at - 1)}
          >
            <ChevronLeftIcon />
            Back
          </LessonSecondaryPill>

          {/* The primary pill is the one decision this question has, and it
              says which one it is: answer it and be told where you stand, or
              move on and be told at the end. */}
          {result ? (
            last ? (
              <LessonPrimaryPill
                title="Answer the quiz again from the first question"
                onClick={() => {
                  setChoices({});
                  setChecked({});
                  setSettled({});
                  setRetaking(true);
                  step(0);
                  // A new sitting, and so a new deal: the same options in the
                  // same places is the shuffle a retake is supposed to undo.
                  qc.invalidateQueries({ queryKey: quizPaperKeys.paper(contentId) });
                }}
              >
                <RotateCcwIcon />
                Try again
              </LessonPrimaryPill>
            ) : (
              <LessonPrimaryPill onClick={() => step(at + 1)}>
                Next
                <ChevronRightIcon />
              </LessonPrimaryPill>
            )
          ) : last ? (
            <LessonPrimaryPill
              busy={submit.isPending}
              disabled={answered === 0}
              title={
                answered === 0
                  ? 'Answer at least one question before handing in'
                  : 'Hand in your answers and be marked'
              }
              onClick={handIn}
            >
              Hand in
            </LessonPrimaryPill>
          ) : !chosen ? (
            <LessonPrimaryPill
              title="Nothing chosen — this moves on and leaves the question unanswered"
              onClick={() => step(at + 1)}
            >
              Skip
              <ChevronRightIcon />
            </LessonPrimaryPill>
          ) : !verdict ? (
            <LessonPrimaryPill
              busy={check.isPending}
              title="Check this answer"
              onClick={() => question && askToCheck(question)}
            >
              Check
            </LessonPrimaryPill>
          ) : (
            <LessonPrimaryPill onClick={() => step(at + 1)}>
              Next
              <ChevronRightIcon />
            </LessonPrimaryPill>
          )}
        </>
      }
    />
  );
}

/** What the quiz's rail shows: the course it sits in, or its discussion. */
function QuizRail({
  material,
  contentId,
  spaceId,
  viewerId,
}: {
  material: LessonPanelTab;
  contentId: string;
  spaceId: string;
  viewerId?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {material === 'discussion' ? (
        <ContentComments contentId={contentId} viewerId={viewerId} canModerate={false} />
      ) : (
        <CourseContents spaceId={spaceId} contentId={contentId} heading={false} />
      )}
    </div>
  );
}

/**
 * Why the answer is the answer, when there is an explanation to give.
 *
 * A box rather than a line of small print, because this is the part of a quiz
 * that teaches: it arrives the moment a question is checked, it is prose rather
 * than a label, and it was set a size *smaller* than the options it is there to
 * explain, which is the wrong way round. The bulb says what it is before a word
 * of it is read, and the words are named for a reader who cannot see the bulb.
 *
 * It is drawn only when a question has one. Reserving its height on every
 * question would put an empty box under questions that will never have anything
 * in it, which is worse than the card growing once, when the learner asks for it.
 */
function ExplanationBox({ text }: { text: string }) {
  return (
    <div className="flex max-h-28 items-start gap-3 overflow-y-auto rounded-2xl border border-border/60 bg-muted/40 px-4 py-3.5 text-left [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <LightbulbIcon
        aria-hidden
        className="mt-0.5 size-5 shrink-0 text-amber-500 dark:text-amber-400"
      />
      <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
        <span className="sr-only">Explanation: </span>
        {text}
      </p>
    </div>
  );
}

/**
 * One question, as it is answered: the prompt, the options, and what a check said.
 *
 * **Nothing on this card appears or disappears when something is chosen or
 * checked**, and that is a requirement rather than a preference: the card centres
 * what is in it, so a row that came and went would move the question and every
 * option under the reader's pointer at the moment they clicked. The verdict goes
 * into the line that was already there — the question's own number — and the
 * option that answers it is marked where it already is.
 */
function PaperQuestion({
  question,
  index,
  total,
  chosen,
  verdict,
  onChoose,
}: {
  question: QuizPaperQuestion;
  index: number;
  total: number;
  chosen?: string;
  /** What a check said about the option that was chosen, if it was checked. */
  verdict?: { correct: boolean; correctOptionIds: string[]; explanation?: string };
  onChoose: (optionId: string) => void;
}) {
  const promptId = `quiz-prompt-${question.questionId}`;

  return (
    // The question's own words name the radio group, which is what a screen
    // reader needs to hear beside each option: a group called "Question 3" is a
    // group nobody can answer without hunting back up the card for the prompt.
    <fieldset aria-labelledby={promptId} className="w-full max-w-3xl">
      <p className="flex items-center justify-center gap-2 text-xs font-medium tabular-nums text-muted-foreground/60">
        Question {index + 1} of {total}
        {verdict && (
          <>
            <span aria-hidden>·</span>
            <span
              className={cn(
                'font-semibold',
                verdict.correct
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-destructive',
              )}
            >
              {verdict.correct ? 'Correct' : 'Not quite'}
            </span>
          </>
        )}
      </p>

      <p
        id={promptId}
        className="mt-3 text-center text-lg font-semibold leading-snug tracking-tight sm:text-xl"
      >
        {question.prompt}
      </p>

      {/* The options are real radios inside real labels: one choice per question
          is what a radio group is, and a set of buttons with `aria-pressed` on
          them would be this drawn by hand and read wrongly by everything that is
          not a browser. What the browser does not do is style the card the
          choice sits in, so the chosen one is styled from the state as well —
          `has-[:focus-visible]` is left to the browser, which is the only thing
          that knows. */}
      <div className="mt-6 grid gap-2">
        {question.options.map((option) => {
          const picked = chosen === option.id;
          const answers = Boolean(verdict?.correctOptionIds.includes(option.id));
          const marked = Boolean(verdict) && (picked || answers);

          return (
            <label
              key={option.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                marked
                  ? answers
                    ? 'border-emerald-600/40 bg-emerald-500/5'
                    : 'border-destructive/40 bg-destructive/5'
                  : picked
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border/60 hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name={question.questionId}
                value={option.id}
                checked={picked}
                onChange={() => onChoose(option.id)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                  marked
                    ? answers
                      ? 'border-emerald-600/60 bg-emerald-600/15 text-emerald-700 dark:text-emerald-300'
                      : 'border-destructive/60 bg-destructive/10 text-destructive'
                    : picked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border',
                )}
              >
                {marked ? (
                  answers ? (
                    <CheckIcon className="size-3" />
                  ) : (
                    <XIcon className="size-3" />
                  )
                ) : picked ? (
                  <CheckIcon className="size-3" />
                ) : null}
              </span>
              <span className="text-sm leading-relaxed sm:text-base">{option.text}</span>
            </label>
          );
        })}
      </div>

      {/* **The room is reserved before there is anything to put in it.** The card
          centres what it holds, so a box appearing out of nothing would push the
          question and every option above it up by half the box's height — at the
          exact moment the learner has looked away from them to press *check*.
          The slot is there from the start, empty and invisible; the box fills it,
          and a long explanation scrolls inside it rather than growing past it. */}
      <div className="mt-5 min-h-28">
        {verdict?.explanation && <ExplanationBox text={verdict.explanation} />}
      </div>
    </fieldset>
  );
}

/**
 * One question after the quiz was handed in: what was chosen, what was right,
 * and why.
 *
 * Drawn entirely from the attempt. What a question asked, what it offered, what
 * answered it and the explanation are all recorded on the attempt rather than
 * looked up, so a quiz whose questions have been rewritten since still shows the
 * sitting that actually happened: the mark was made against those words, and
 * re-rendering them beside it is the only honest thing to do with it.
 */
function MarkedQuestion({
  answer,
  index,
  total,
  dropped,
}: {
  answer: QuizAttemptAnswer;
  index: number;
  total: number;
  /** Answers handed in that were not marked, said once rather than per question. */
  dropped: number;
}) {
  return (
    <div className="w-full max-w-3xl">
      <p className="text-xs font-medium tabular-nums text-muted-foreground/60">
        Question {index + 1} of {total}
      </p>

      <div className="mt-3 flex items-start justify-center gap-3">
        <p className="text-center text-lg font-semibold leading-snug tracking-tight sm:text-xl">
          {answer.prompt}
        </p>
        <span
          className={cn(
            'mt-1 flex size-6 shrink-0 items-center justify-center rounded-full',
            answer.correct
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-destructive/10 text-destructive',
          )}
        >
          {answer.correct ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />}
          <span className="sr-only">{answer.correct ? 'Right' : 'Wrong'}</span>
        </span>
      </div>

      <ul className="mt-6 grid gap-2">
        {answer.options.map((option) => {
          const right = answer.correctOptionIds.includes(option.id);
          const picked = answer.optionId === option.id;
          return (
            <li
              key={option.id}
              className={cn(
                'flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm sm:text-base',
                right
                  ? 'border-emerald-600/40 bg-emerald-500/5'
                  : picked
                    ? 'border-destructive/40 bg-destructive/5'
                    : 'border-border/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                  right
                    ? 'border-emerald-600/60 bg-emerald-600/15 text-emerald-700 dark:text-emerald-300'
                    : picked
                      ? 'border-destructive/60 bg-destructive/10 text-destructive'
                      : 'border-border',
                )}
              >
                {right ? (
                  <CheckIcon className="size-3" />
                ) : picked ? (
                  <XIcon className="size-3" />
                ) : null}
              </span>
              <span className="leading-relaxed">{option.text}</span>
              {picked && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">Your answer</span>
              )}
              {!picked && right && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">Right answer</span>
              )}
            </li>
          );
        })}
      </ul>

      {!answer.optionId && (
        <p className="mt-3 text-center text-xs text-muted-foreground">You skipped this one.</p>
      )}

      {answer.explanation && <ExplanationBox text={answer.explanation} />}

      {index === total - 1 && dropped > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {dropped === 1 ? 'One answer was' : `${dropped} answers were`} not marked — the quiz
          changed while it was being sat.
        </p>
      )}
    </div>
  );
}

/**
 * Answers handed in that were not marked.
 *
 * An author editing a quiz while somebody is sitting it is not an error to
 * refuse — the learner did nothing wrong — so those answers are dropped, and
 * counted rather than passed over in silence.
 */
function droppedAnswers(attempt: QuizAttempt | undefined, choices: Record<string, string>): number {
  if (!attempt) return 0;
  const marked = new Set(attempt.answers.map((answer) => answer.questionId));
  return Object.keys(choices).filter((questionId) => !marked.has(questionId)).length;
}

/** What a quiz shows when there is nothing in it to answer. */
function NothingToAnswer({
  heldBack,
  attempt,
}: {
  heldBack: number;
  /** An earlier sitting, which is still worth showing. See the caller. */
  attempt?: QuizAttempt;
}) {
  return (
    <div className="grid max-w-xl justify-items-center gap-3 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <HelpCircleIcon className="size-5" />
      </div>
      <p className="text-base font-semibold tracking-tight">
        {heldBack > 0 ? 'This quiz is still being reviewed' : 'This quiz has no questions yet'}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {heldBack > 0
          ? `Its ${heldBack === 1 ? 'question has' : 'questions have'} been written, but nobody has read ${heldBack === 1 ? 'it' : 'them'} and confirmed ${heldBack === 1 ? 'it is' : 'they are'} right yet — and a question nobody has checked is not asked of a learner.`
          : 'Questions are written and reviewed in Play Studio. There is nothing to answer here yet.'}
      </p>

      {/* A sitting already made is still worth its score: the paper can be empty
          because the author took the questions back to a draft, and hiding an
          attempt somebody has already had because of what an author did
          afterwards is not this page's decision to make. */}
      {attempt && (
        <p className="mt-1 text-sm text-muted-foreground">
          Your last sitting scored{' '}
          <span className="font-medium tabular-nums text-foreground">{attempt.score}%</span> —{' '}
          {attempt.correctCount} of {attempt.questionCount} right.
        </p>
      )}
    </div>
  );
}
