'use client';

import { useEffect, useMemo, useState } from 'react';
import { HelpCircleIcon, Loader2Icon, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/components/ui/dialog';
import { Input } from '@ui/components/ui/input';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useBankQuestions, useAddQuizQuestions } from '@api/modules/question/question.queries';
import { BankPicker } from './bank-picker';
import { QuestionBody, StatusChip } from './question-parts';
import { QUESTION_TYPE_LABELS, type QuizQuestion } from '@play/types';

/**
 * Picking questions out of a bank for a quiz to ask.
 *
 * This is what banks are for, and it is deliberately a list rather than a
 * search: a bank is a few dozen questions an author has read, and the ones they
 * want are the ones about the lesson they are working through. So the list is
 * filtered by lesson first — only the course's own lessons, because those are
 * the only questions the API will let the quiz ask — and by free text second,
 * for the case where somebody remembers a word from the question.
 *
 * Adding is per question rather than per bank: a bank may serve several courses,
 * and a quiz wants the questions about *its* lessons.
 */
export function AddFromBankDialog({
  orgId,
  contentId,
  spaceId,
  open,
  onOpenChange,
}: {
  orgId: string;
  /** The quiz the questions are added to. */
  contentId: string;
  /** The quiz's course: only its lessons' questions can be asked. */
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [bankId, setBankId] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);

  const { data, isLoading, isError, error } = useBankQuestions(bankId);
  const add = useAddQuizQuestions(contentId);

  useEffect(() => {
    if (!open) return;
    setBankId('');
    setQuery('');
    setChosen([]);
  }, [open]);

  /**
   * The bank's questions about this course's lessons.
   *
   * Filtered here rather than in the request because the API's rule is about the
   * *quiz*, not about the read: a bank is browsable in full, and what a quiz may
   * ask is a smaller set. Showing the excluded ones as unselectable would be a
   * longer list for no more choice.
   */
  const askable = useMemo(
    () => (data?.questions ?? []).filter((question) => question.lessonSpaceId === spaceId),
    [data, spaceId],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return askable;
    return askable.filter(
      (question) =>
        question.prompt.toLowerCase().includes(needle) ||
        question.options.some((option) => option.text.toLowerCase().includes(needle)),
    );
  }, [askable, query]);

  function toggle(question: QuizQuestion) {
    setChosen((current) =>
      current.includes(question.questionId)
        ? current.filter((id) => id !== question.questionId)
        : [...current, question.questionId],
    );
  }

  async function submit() {
    try {
      const result = await add.mutateAsync(chosen);
      toast.success(
        `Added ${result.added} question${result.added === 1 ? '' : 's'}` +
          (result.alreadyAsked > 0 ? ` · ${result.alreadyAsked} were already asked` : ''),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the questions');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add questions from a bank</DialogTitle>
          <DialogDescription>
            The questions stay in their bank — this quiz asks them, and another quiz can ask the
            same ones.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <BankPicker orgId={orgId} value={bankId} onChange={setBankId} disabled={add.isPending} />

          {bankId && (
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this bank"
                className="pl-9"
              />
            </div>
          )}

          <div className="max-h-80 overflow-y-auto">
            {!bankId ? null : isLoading ? (
              <div className="grid gap-2">
                <Skeleton className="h-20 rounded-2xl" />
                <Skeleton className="h-20 rounded-2xl" />
              </div>
            ) : isError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
                <p className="font-medium">The bank could not be read</p>
                <p className="mt-0.5 text-muted-foreground">
                  {error instanceof Error ? error.message : 'Something went wrong reading it.'}
                </p>
              </div>
            ) : askable.length === 0 ? (
              <div className="grid justify-items-center gap-2 rounded-2xl border border-border/60 bg-muted/20 px-4 py-10 text-center">
                <HelpCircleIcon className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">Nothing here for this course</p>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  A quiz asks questions about its own course&rsquo;s lessons. This bank has none of
                  them — write some about a lesson of this course, or pick another bank.
                </p>
              </div>
            ) : shown.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                Nothing matches “{query.trim()}”.
              </p>
            ) : (
              <ul className="grid gap-2">
                {shown.map((question) => {
                  const selected = chosen.includes(question.questionId);
                  return (
                    <li key={question.questionId}>
                      <button
                        type="button"
                        onClick={() => toggle(question)}
                        aria-pressed={selected}
                        className={cn(
                          'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                          selected
                            ? 'border-foreground/30 bg-muted/60'
                            : 'border-border/60 bg-card hover:bg-muted/30',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-xs',
                              selected ? 'border-foreground bg-foreground text-background' : 'border-input',
                            )}
                          >
                            {selected ? '✓' : ''}
                          </span>
                          <div className="min-w-0 flex-1">
                            <QuestionBody question={question} />
                          </div>
                          <StatusChip question={question} />
                        </div>
                        <p className="mt-2 pl-7 text-xs text-muted-foreground">
                          {QUESTION_TYPE_LABELS[question.type]}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={chosen.length === 0 || add.isPending}>
            {add.isPending && <Loader2Icon className="animate-spin" />}
            Add {chosen.length > 0 ? chosen.length : ''} question{chosen.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
