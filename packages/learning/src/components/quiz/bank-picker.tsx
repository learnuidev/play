'use client';

import { Label } from '@ui/components/ui/label';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useQuestionBanks } from '@api/modules/question/question.queries';

/**
 * Which bank a question is written into, or picked from.
 *
 * A select rather than a dialog of its own, because the choice is always made
 * inside something else that is already a dialog: the question editor, the
 * import, the generator, and the picker a quiz uses. The empty case says what to
 * do about it rather than offering a link into a flow that would replace the one
 * the author is in.
 */
export function BankPicker({
  orgId,
  value,
  onChange,
  disabled,
}: {
  orgId: string;
  /** The bank chosen, or `''`. */
  value: string;
  onChange: (bankId: string) => void;
  disabled?: boolean;
}) {
  const { data, isLoading } = useQuestionBanks(orgId);
  const banks = data?.banks ?? [];

  return (
    <div className="grid gap-2">
      <Label htmlFor="question-bank">Bank</Label>
      {isLoading ? (
        <Skeleton className="h-9 w-full rounded-md" />
      ) : banks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This organization has no question banks yet. Make one in its question banks section — the
          questions live there, and quizzes ask them.
        </p>
      ) : (
        <select
          id="question-bank"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
        >
          <option value="">Choose a bank</option>
          {banks.map((bank) => (
            <option key={bank.bankId} value={bank.bankId}>
              {bank.name} — {bank.questionCount} question{bank.questionCount === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
