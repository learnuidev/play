'use client';

import { useEffect, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ui/components/ui/dialog';
import { Input } from '@ui/components/ui/input';
import { Label } from '@ui/components/ui/label';
import { Textarea } from '@ui/components/ui/textarea';
import { useCreateQuestionBank, useUpdateQuestionBank } from '@api/modules/question/question.queries';
import type { QuestionBank } from '@play/types';

// Mirrors the server-side limits, so the form fails fast instead of round-tripping.
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Making a bank, or renaming one.
 *
 * The same dialog in both directions: a bank is a name and a sentence about what
 * is in it, and whether it exists yet is the only difference between the two
 * modes. A bank is an organization's rather than a course's — the questions in it
 * are about lessons, and a question worth writing carefully is worth asking in
 * more than one place.
 */
export function BankDialog({
  orgId,
  bank,
  trigger,
  open,
  onOpenChange,
}: {
  orgId: string;
  /** Omit to make a new one. */
  bank?: QuestionBank;
  trigger?: React.ReactNode;
  /** Controlled openness. Omit to let the trigger manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const [name, setName] = useState(bank?.name ?? '');
  const [description, setDescription] = useState(bank?.description ?? '');

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : uncontrolled;
  const setOpen = (next: boolean) => (isControlled ? onOpenChange?.(next) : setUncontrolled(next));

  const create = useCreateQuestionBank(orgId);
  const update = useUpdateQuestionBank(bank?.bankId ?? '', orgId);
  const pending = create.isPending || update.isPending;

  // Opening shows the bank as it now is, not as it was when the page loaded.
  useEffect(() => {
    if (!isOpen) return;
    setName(bank?.name ?? '');
    setDescription(bank?.description ?? '');
  }, [isOpen, bank]);

  const trimmed = name.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_NAME_LENGTH;
  const canSubmit = trimmed.length >= MIN_NAME_LENGTH && !pending;

  async function submit() {
    try {
      if (bank) {
        await update.mutateAsync({ name: trimmed, description: description.trim() });
        toast.success('Bank saved');
      } else {
        await create.mutateAsync({ name: trimmed, description: description.trim() });
        toast.success('Question bank created');
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the bank');
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{bank ? 'Edit bank' : 'New question bank'}</DialogTitle>
          <DialogDescription>
            {bank
              ? 'Its name and what it says about itself. The questions are untouched.'
              : 'A bank is where your organization keeps questions. Each one is about a lesson, and any quiz teaching that lesson can ask it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="bank-name">Name</Label>
            <Input
              id="bank-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Biology — cell division"
              maxLength={MAX_NAME_LENGTH}
              autoFocus
            />
            {tooShort && (
              <p className="text-xs text-destructive">
                At least {MIN_NAME_LENGTH} characters — “{trimmed}” is too short.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="bank-description">Description</Label>
            <Textarea
              id="bank-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What these questions are for, and who reads them."
              maxLength={MAX_DESCRIPTION_LENGTH}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {pending && <Loader2Icon className="animate-spin" />}
            {bank ? 'Save bank' : 'Create bank'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
