'use client';

import { cn } from '@ui/lib/utils';
import { Label } from '@ui/components/ui/label';
import {
  QUESTION_DIFFICULTIES,
  QUESTION_DIFFICULTY_DESCRIPTIONS,
  QUESTION_DIFFICULTY_LABELS,
  QUESTION_DIFFICULTY_TARGETS,
  type QuestionDifficulty,
} from '@play/types';

/**
 * How hard a question is meant to be, and what the level in hand means.
 *
 * Four levels rather than a slider or a number, because "easy" is only useful if
 * two authors mean the same thing by it — and the whole point of the four is that
 * each one is a *band of expected correct rate* with a way of writing attached.
 * So the picker is not just the four words: the chosen level's band and its
 * characteristics are stated underneath, which is what an author actually needs
 * to judge whether the question they have written is the level they picked. A
 * bare dropdown of Easy/Medium/Hard/Expert teaches nobody anything.
 *
 * `undefined` is a real state rather than an empty one: it is a question that
 * arrived before levels existed, or from a file with no difficulty column, and
 * the picker says so instead of quietly reading the gap as Easy. It is used by
 * the same three dialogs that write a question — the form, and the two that ask
 * a model for a set — which is why it is a component rather than markup repeated
 * three times.
 */
export function DifficultyPicker({
  value,
  onChange,
  disabled,
}: {
  /** The level chosen, or `undefined` for a question nobody has graded. */
  value: QuestionDifficulty | undefined;
  onChange: (difficulty: QuestionDifficulty) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label>Difficulty</Label>

      <div className="flex w-fit gap-0.5 rounded-full bg-muted/70 p-0.5">
        {QUESTION_DIFFICULTIES.map((difficulty) => (
          <button
            key={difficulty}
            type="button"
            onClick={() => onChange(difficulty)}
            disabled={disabled}
            aria-pressed={value === difficulty}
            // The band on the button itself, so comparing the four is a hover
            // rather than four clicks.
            title={`${QUESTION_DIFFICULTY_TARGETS[difficulty]} — ${QUESTION_DIFFICULTY_DESCRIPTIONS[difficulty]}`}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-sm transition-colors',
              value === difficulty
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {QUESTION_DIFFICULTY_LABELS[difficulty]}
          </button>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {value ? (
          <>
            <span className="font-medium text-foreground">
              {QUESTION_DIFFICULTY_TARGETS[value]}
            </span>{' '}
            — {QUESTION_DIFFICULTY_DESCRIPTIONS[value]}
          </>
        ) : (
          'Not graded. A question keeps no level until somebody gives it one.'
        )}
      </p>
    </div>
  );
}
