'use client';

import { useState } from 'react';
import {
  CheckIcon,
  HelpCircleIcon,
  Loader2Icon,
  RotateCcwIcon,
  TrophyIcon,
  XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useQuizPaper, useSubmitQuizAttempt } from '@api/modules/question/question.queries';
import type { QuizAttempt, QuizPaperQuestion } from '@play/types';

/**
 * A quiz, as the person taking it sees it.
 *
 * The other half of `QuizPanel`: an author is handed the questions *with* the
 * answer key and edits them, and a learner is handed the same questions without
 * it and answers them. The two share nothing on the screen and nothing but the
 * quiz's id, which is why this is a component of its own rather than a branch
 * inside that one.
 *
 * Three rules it is built on:
 *
 * - **The answers are never here.** The paper arrives without them, and what a
 *   question's right answer was comes back only after it has been answered —
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
}: {
  contentId: string;
  spaceId: string;
}) {
  const { data, isLoading, isError, error } = useQuizPaper(contentId);
  const submit = useSubmitQuizAttempt(contentId, spaceId);

  /** The option chosen for each question. A question absent from it is unanswered. */
  const [choices, setChoices] = useState<Record<string, string>>({});

  /**
   * Whether they are answering rather than reading a result.
   *
   * Only ever set by the learner: the newest attempt is what a page opens on,
   * because somebody coming back to a quiz they have sat is far more often
   * checking their score than starting again.
   */
  const [retaking, setRetaking] = useState(false);

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Failed to load this quiz'}
      </p>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-9 w-56 rounded-full" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    );
  }

  const { questions, heldBack, attempts, lastAttempt } = data;
  const answered = questions.filter((question) => choices[question.questionId] !== undefined).length;

  /**
   * What the page is showing: the attempt just handed in, or the newest one on
   * record — unless they are answering again, when it is the paper.
   *
   * The submitted attempt is preferred to the stored one so the result is drawn
   * the moment the request returns rather than after the paper is read again;
   * the two agree a moment later, when that read lands.
   */
  const result = retaking ? undefined : submit.data?.attempt ?? lastAttempt;

  function choose(questionId: string, optionId: string) {
    setChoices((previous) => ({ ...previous, [questionId]: optionId }));
  }

  async function handIn() {
    try {
      const { attempt } = await submit.mutateAsync({
        answers: questions
          .filter((question) => choices[question.questionId] !== undefined)
          .map((question) => ({
            questionId: question.questionId,
            optionId: choices[question.questionId],
          })),
      });

      setRetaking(false);
      toast.success(`You scored ${attempt.score}%`, {
        description: `${attempt.correctCount} of ${attempt.questionCount} right. The quiz is finished either way — you can sit it again.`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not hand in your answers');
    }
  }

  if (questions.length === 0) {
    return (
      <div className="grid gap-5">
        <NothingToAnswer heldBack={heldBack} />
        {/* An attempt already made is still shown, below the explanation. The
            paper can be empty because the author took the questions back to a
            draft, and hiding a sitting somebody has already had because of what
            an author did afterwards is not this page's decision to make. */}
        {lastAttempt && <MarkedAttempt attempt={lastAttempt} answered={{}} />}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{questions.length}</span> question
          {questions.length === 1 ? '' : 's'}
          {/* The sittings the API reads at once — the most recent twenty. Past
              that this says twenty rather than the truth, which is a trade
              nobody has to make: it is twenty goes at one quiz. */}
          {attempts.length > 0 && (
            <>
              {' · '}
              {attempts.length === 1 ? 'sat once' : `sat ${attempts.length} times`}
              {' · best '}
              <span className="font-medium tabular-nums text-foreground">
                {Math.max(...attempts.map((attempt) => attempt.score))}%
              </span>
            </>
          )}
        </p>

        {result && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto rounded-full"
            onClick={() => {
              setChoices({});
              setRetaking(true);
            }}
          >
            <RotateCcwIcon />
            Try again
          </Button>
        )}
      </div>

      {/* Said rather than hidden: a quiz that looks short because half of it is
          unread is a quiz that looks broken, and the reader has no way to tell. */}
      {heldBack > 0 && (
        <p className="text-xs text-muted-foreground">
          {heldBack === 1
            ? 'One more question is waiting to be read and confirmed by the author, so it is not being asked yet.'
            : `${heldBack} more questions are waiting to be read and confirmed by the author, so they are not being asked yet.`}
        </p>
      )}

      {result ? (
        <MarkedAttempt attempt={result} answered={choices} />
      ) : (
        <>
          <ol className="grid gap-4">
            {questions.map((question, index) => (
              <li key={question.questionId}>
                <PaperQuestion
                  question={question}
                  index={index}
                  chosen={choices[question.questionId]}
                  onChoose={(optionId) => choose(question.questionId, optionId)}
                />
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              size="lg"
              className="rounded-full"
              disabled={submit.isPending || answered === 0}
              onClick={handIn}
            >
              {submit.isPending ? <Loader2Icon className="animate-spin" /> : null}
              Hand in
            </Button>
            <p className="text-sm text-muted-foreground">
              {answered} of {questions.length} answered · handing in finishes the quiz
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** One question, as it is answered: the prompt, and the options to pick from. */
function PaperQuestion({
  question,
  index,
  chosen,
  onChoose,
}: {
  question: QuizPaperQuestion;
  index: number;
  chosen?: string;
  onChoose: (optionId: string) => void;
}) {
  const promptId = `quiz-prompt-${question.questionId}`;

  return (
    // The question's own words name the radio group, which is what a screen
    // reader needs to hear beside each option: a group called "Question 3" is a
    // group nobody can answer without hunting back up the page for the prompt.
    <fieldset
      aria-labelledby={promptId}
      className="rounded-3xl border border-border/60 bg-card px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 w-5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground/60"
        >
          {index + 1}
        </span>
        <p id={promptId} className="text-sm font-medium leading-relaxed">
          {question.prompt}
        </p>
      </div>

      {/* The options are real radios inside real labels: one choice per question
          is what a radio group is, and a set of buttons with `aria-pressed` on
          them would be this drawn by hand and read wrongly by everything that is
          not a browser. What the browser does not do is style the card the
          choice sits in, so the checked one is styled from the state as well —
          `has-[:focus-visible]` is left to the browser, which is the only thing
          that knows. */}
      <div className="mt-3 grid gap-1.5 pl-8">
        {question.options.map((option) => (
          <label
            key={option.id}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 transition-colors',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
              chosen === option.id
                ? 'border-primary/50 bg-primary/5'
                : 'border-border/60 hover:bg-muted/40',
            )}
          >
            <input
              type="radio"
              name={question.questionId}
              value={option.id}
              checked={chosen === option.id}
              onChange={() => onChoose(option.id)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                chosen === option.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border',
              )}
            >
              {chosen === option.id && <CheckIcon className="size-3" />}
            </span>
            <span className="text-sm leading-relaxed">{option.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * What a learner is shown after handing in, and after coming back later.
 *
 * The same view either way, and it is drawn entirely from the attempt. What a
 * question asked, what it offered, what answered it and why are all recorded on
 * the attempt rather than looked up, so a quiz whose questions have been
 * rewritten since still shows the sitting that actually happened: the mark was
 * made against those words, and re-rendering them beside it is the only honest
 * thing to do with it.
 */
function MarkedAttempt({
  attempt,
  answered,
}: {
  attempt: QuizAttempt;
  answered: Record<string, string>;
}) {
  /**
   * Answers handed in that were not marked.
   *
   * An author editing a quiz while somebody is sitting it is not an error to
   * refuse — the learner did nothing wrong — so those answers are dropped, and
   * counted here rather than passed over in silence.
   */
  const marked = new Set(attempt.answers.map((answer) => answer.questionId));
  const dropped = Object.keys(answered).filter((questionId) => !marked.has(questionId)).length;

  return (
    <div className="grid gap-4">
      <div className="rounded-3xl border border-border/60 bg-card px-6 py-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-2xl font-semibold tabular-nums">{attempt.score}%</p>
          <p className="text-sm text-muted-foreground">
            {attempt.correctCount} of {attempt.questionCount} right
          </p>
          {attempt.score === 100 && (
            <TrophyIcon
              role="img"
              aria-label="Everything right"
              className="size-4 self-center text-amber-600 dark:text-amber-400"
            />
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Sat {satOn(attempt.submittedAt)}
        </p>

        {dropped > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {dropped === 1 ? 'One answer was' : `${dropped} answers were`} not marked — the quiz
            changed while it was being sat.
          </p>
        )}
      </div>

      <ol className="grid gap-4">
        {attempt.answers.map((answer, index) => (
          <li key={answer.questionId} className="rounded-3xl border border-border/60 bg-card px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 w-5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground/60">
                {index + 1}
              </span>
              <p className="text-sm font-medium leading-relaxed">{answer.prompt}</p>
              <span
                className={cn(
                  'ml-auto flex size-5 shrink-0 items-center justify-center rounded-full',
                  answer.correct
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                {answer.correct ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
                <span className="sr-only">{answer.correct ? 'Right' : 'Wrong'}</span>
              </span>
            </div>

            <ul className="mt-3 grid gap-1.5 pl-8">
              {answer.options.map((option) => {
                const right = answer.correctOptionIds.includes(option.id);
                const picked = answer.optionId === option.id;
                return (
                  <li
                    key={option.id}
                    className={cn(
                      'flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-sm',
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
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
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
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        Your answer
                      </span>
                    )}
                    {!picked && right && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        Right answer
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            {!answer.optionId && (
              <p className="mt-2 pl-8 text-xs text-muted-foreground">You skipped this one.</p>
            )}

            {answer.explanation && (
              <p className="mt-2 pl-8 text-sm leading-relaxed text-muted-foreground">
                {answer.explanation}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** What a quiz shows when there is nothing in it to answer. */
function NothingToAnswer({ heldBack }: { heldBack: number }) {
  return (
    <div className="grid justify-items-center gap-3 rounded-3xl border border-border/60 bg-card py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <HelpCircleIcon className="size-5" />
      </div>
      <p className="text-base font-semibold tracking-tight">
        {heldBack > 0 ? 'This quiz is still being reviewed' : 'This quiz has no questions yet'}
      </p>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {heldBack > 0
          ? `Its ${heldBack === 1 ? 'question has' : 'questions have'} been written, but nobody has read ${heldBack === 1 ? 'it' : 'them'} and confirmed ${heldBack === 1 ? 'it is' : 'they are'} right yet — and a question nobody has checked is not asked of a learner.`
          : 'Questions are written and reviewed in Play Studio. There is nothing to answer here yet.'}
      </p>
    </div>
  );
}

/**
 * When an attempt was sat, in the reader's own zone.
 *
 * Not `formatDate`, which renders UTC because the dates it was written for are
 * *days* a course was scheduled on. This is a moment somebody sat something, and
 * a learner in the evening west of UTC should not be told they sat it tomorrow.
 */
function satOn(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}
