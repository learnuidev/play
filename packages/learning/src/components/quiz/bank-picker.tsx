'use client';

import { useState } from 'react';
import { Loader2Icon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useCreateQuestionBank, useQuestionBanks } from '@api/modules/question/question.queries';

// Mirrors the server-side limit, so the form fails fast instead of round-tripping.
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;

/**
 * Which bank a question is written into, or picked from.
 *
 * **A bank can be made from here**, and that is the point of the second control:
 * a question lives in a bank, so every dialog that writes one needs a bank to
 * exist first — and an organization that has never used questions has none. A
 * picker that only offered "choose one of your banks" would be a dead end on the
 * first visit, with the fix a section away and the reason unstated.
 *
 * Choosing an existing bank selects it; naming a new one makes it and selects it,
 * so the caller deals in one thing: a bank id.
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
  const { data, isLoading, isError, error } = useQuestionBanks(orgId);
  const create = useCreateQuestionBank(orgId);

  const [newName, setNewName] = useState('');
  const banks = data?.banks ?? [];

  const trimmed = newName.trim();
  const canCreate = trimmed.length >= MIN_NAME_LENGTH && !create.isPending && !disabled;

  async function makeBank() {
    try {
      const { bank } = await create.mutateAsync({ name: trimmed });
      setNewName('');
      onChange(bank.bankId);
      toast.success(`Bank “${bank.name}” created`, {
        description: 'Its questions can be asked by any course teaching the lesson they are about.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the bank');
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor="question-bank">Bank</Label>

      {isLoading ? (
        <Skeleton className="h-9 w-full rounded-md" />
      ) : isError ? (
        // Said rather than swallowed: a list that failed to load is not a list
        // of nothing, and telling somebody they have no banks when the request
        // was refused sends them looking in the wrong place.
        <p className="text-xs text-destructive">
          {error instanceof Error ? error.message : 'Could not read this organization’s banks'}
        </p>
      ) : banks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This organization has no question banks yet — name one below and it is made as you go.
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

      <div className="flex items-center gap-2">
        <Input
          value={newName}
          disabled={disabled || create.isPending}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            // Enter here is the button beside it, not a submit: this sits inside
            // forms of its own (a dialog's footer), and a stray Enter would send
            // whatever is half-written with it.
            if (event.key === 'Enter') {
              event.preventDefault();
              if (canCreate) void makeBank();
            }
          }}
          placeholder="Or name a new bank"
          maxLength={MAX_NAME_LENGTH}
          aria-label="New bank name"
        />
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={makeBank} disabled={!canCreate}>
          {create.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
          Make it
        </Button>
      </div>
    </div>
  );
}
