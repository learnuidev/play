'use client';

import { BadgeCheckIcon, CircleDashedIcon } from 'lucide-react';
import { cn } from '@ui/lib/utils';
import {
  QUESTION_DIFFICULTY_DESCRIPTIONS,
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_DIFFICULTY_TARGETS,
  QUESTION_SOURCE_LABELS,
  QUESTION_STATUS_LABELS,
  QUESTION_TYPE_LABELS,
  type QuizQuestion,
} from '@play/types';

/**
 * The small pieces of a question, shared by the two places one is listed: the
 * page of the bank it lives in, and the page of a quiz that asks it.
 *
 * They are the same facts in both — what it asks, whether anybody has read it,
 * where it came from, how hard it is meant to be, and which lesson it is about —
 * which is why they are one file rather than two that happen to look alike. What
 * differs between the two lists is what can be *done* to a row, and that stays
 * with each list.
 */

/** The chip a question's verification state is drawn with. */
export function StatusChip({ question }: { question: QuizQuestion }) {
  const verified = question.status === 'VERIFIED';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        verified
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
      title={
        verified && question.verifiedAt
          ? `Verified ${new Date(question.verifiedAt).toLocaleString()}`
          : 'Nobody has read this question yet'
      }
    >
      {verified ? <BadgeCheckIcon className="size-3" /> : <CircleDashedIcon className="size-3" />}
      {QUESTION_STATUS_LABELS[question.status]}
    </span>
  );
}

/** Where a question came from, so a reviewer knows whose words they are reading. */
export function SourceChip({ question }: { question: QuizQuestion }) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {QUESTION_SOURCE_LABELS[question.source]}
    </span>
  );
}

/**
 * How hard a question is meant to be, when somebody said.
 *
 * Nothing at all for a question with no level, rather than a chip reading
 * "Unrated": a list is read by scanning it, and a word that means "no answer" on
 * every row written before this existed is noise. The band the level stands for
 * is on the hover, which is where the four words are explained.
 */
export function DifficultyChip({ question }: { question: QuizQuestion }) {
  const difficulty = question.difficulty;
  if (!difficulty) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
      title={`${QUESTION_DIFFICULTY_TARGETS[difficulty]} — ${QUESTION_DIFFICULTY_DESCRIPTIONS[difficulty]}`}
    >
      {QUESTION_DIFFICULTY_LABELS[difficulty]}
    </span>
  );
}

/** The prompt and its options, with the right answer marked. */
export function QuestionBody({ question }: { question: QuizQuestion }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium leading-snug">{question.prompt}</p>

      <ul className="grid gap-0.5 text-xs text-muted-foreground">
        {question.options.map((option) => {
          const correct = question.correctOptionIds.includes(option.id);
          return (
            <li key={option.id} className="flex items-baseline gap-2">
              <span
                className={cn(
                  'w-3 shrink-0 font-medium uppercase',
                  correct && 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {option.id}
              </span>
              <span className={cn(correct && 'font-medium text-emerald-700 dark:text-emerald-400')}>
                {option.text}
                {correct && ' ✓'}
              </span>
            </li>
          );
        })}
      </ul>

      {question.explanation && (
        <p className="text-xs leading-relaxed text-muted-foreground">{question.explanation}</p>
      )}
    </div>
  );
}

/** The facts line under a question: its kind, its level, its status, and its source. */
export function QuestionFacts({
  question,
  extra,
}: {
  question: QuizQuestion;
  /** What the list knows that the question does not — its lesson, its bank. */
  extra?: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <StatusChip question={question} />
      <DifficultyChip question={question} />
      <span className="text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[question.type]}</span>
      <SourceChip question={question} />
      {extra}
    </div>
  );
}
