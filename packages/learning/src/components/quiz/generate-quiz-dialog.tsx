'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2Icon, SparklesIcon } from 'lucide-react';
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
import { Label } from '@ui/components/ui/label';
import { useCreateContent, usePlaceContent } from '@api/modules/content/content.queries';
import { useCreateQuestionBank, useGenerateQuestions } from '@api/modules/question/question.queries';
import { useLearningRoutes } from '@learning/lib/learning-routes';
import { BankPicker } from './bank-picker';
import { DifficultyPicker } from './difficulty-picker';
import {
  DEFAULT_QUESTION_DIFFICULTY,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type QuestionDifficulty,
  type QuestionType,
} from '@play/types';

const DEFAULT_COUNT = 10;
const MAX_COUNT = 20;

/** The API's ceiling for a content title, less the prefix this dialog adds. */
const MAX_TITLE_LENGTH = 120;
const TITLE_PREFIX = 'Quiz: ';

/**
 * Making a quiz out of the lesson being read, in one go.
 *
 * The shortcut the feature is for: an author watches a lesson, decides it should
 * be checked, and does not want to go and create a quiz, find the lesson in a
 * list, and pick it there. Four things happen, in an order that matters:
 *
 * 1. **the bank** they chose is used, or made — questions live in banks, and a
 *    quiz only asks them, so a quiz cannot be filled without one;
 * 2. **the quiz** is created in the lesson's own section;
 * 3. **it is moved** to sit directly under the lesson it came from, which is
 *    where a reader expects the check on what they have just watched;
 * 4. **the run is asked for**, with `addToContentId` naming the quiz — so the
 *    questions are written into the bank *and* added to the quiz when they
 *    arrive, and the author comes back to a quiz that already asks them.
 *
 * A run asked for before the quiz existed would be writing into a quiz that is
 * still at the end of the section, which is where the reader would then be
 * looking for it.
 */
export function GenerateQuizDialog({
  orgId,
  spaceId,
  sectionId,
  lessonContentId,
  lessonTitle,
  open,
  onOpenChange,
}: {
  orgId: string;
  spaceId: string;
  /** The section the lesson is in — the quiz is filed with it. */
  sectionId: string;
  /** The lesson the questions are written from, and about. */
  lessonContentId: string;
  lessonTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const routes = useLearningRoutes();
  const router = useRouter();

  const [bankId, setBankId] = useState('');
  const [newBankName, setNewBankName] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [types, setTypes] = useState<QuestionType[]>([...QUESTION_TYPES]);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>(DEFAULT_QUESTION_DIFFICULTY);

  const createBank = useCreateQuestionBank(orgId);
  const createQuiz = useCreateContent(sectionId, spaceId);
  const placeQuiz = usePlaceContent(spaceId);
  const generate = useGenerateQuestions();

  const pending = createBank.isPending || createQuiz.isPending || placeQuiz.isPending || generate.isPending;

  useEffect(() => {
    if (!open) return;
    setBankId('');
    setNewBankName('');
    setCount(DEFAULT_COUNT);
    setTypes([...QUESTION_TYPES]);
    setDifficulty(DEFAULT_QUESTION_DIFFICULTY);
  }, [open]);

  const canSubmit = Boolean(bankId || newBankName.trim()) && !pending;

  function toggleType(type: QuestionType) {
    setTypes((current) => {
      if (current.includes(type)) return current.length === 1 ? current : current.filter((entry) => entry !== type);
      return QUESTION_TYPES.filter((entry) => current.includes(entry) || entry === type);
    });
  }

  async function submit() {
    try {
      // A bank made here is named by the author and belongs to the organization,
      // so it is there for the next lesson's quiz as well.
      const destinationBankId = newBankName.trim()
        ? (await createBank.mutateAsync({ name: newBankName.trim() })).bank.bankId
        : bankId;

      const { content: quiz } = await createQuiz.mutateAsync({
        title: `${TITLE_PREFIX}${lessonTitle}`.slice(0, MAX_TITLE_LENGTH),
        type: 'QUIZ',
      });

      await generate.mutateAsync({
        bankId: destinationBankId,
        lessonContentId,
        count,
        types,
        difficulty,
        addToContentId: quiz.contentId,
      });

      await placeQuiz.mutateAsync({
        contentId: quiz.contentId,
        sectionId,
        index: 0,
      });

      toast.success('Quiz created', {
        description: 'Questions are being written from this lesson into the bank you chose.',
      });
      onOpenChange(false);
      router.push(routes.lesson(spaceId, quiz.contentId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the quiz');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate a quiz from this lesson</DialogTitle>
          <DialogDescription>
            A model writes questions about “{lessonTitle}” into a bank, and the quiz it makes asks
            them. Every question arrives needing verification.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <BankPicker orgId={orgId} value={newBankName.trim() ? '' : bankId} onChange={setBankId} disabled={pending} />

          <div className="grid gap-2">
            <Label htmlFor="new-bank-name">Or a new bank</Label>
            <Input
              id="new-bank-name"
              value={newBankName}
              onChange={(event) => {
                setNewBankName(event.target.value);
                if (event.target.value.trim()) setBankId('');
              }}
              placeholder="Biology — cell division"
              maxLength={80}
            />
            <p className="text-xs text-muted-foreground">
              A bank belongs to this organization, so its questions can be asked by any course that
              teaches the lesson.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="generate-quiz-count">How many questions</Label>
            <div className="flex items-center gap-3">
              <input
                id="generate-quiz-count"
                type="range"
                min={1}
                max={MAX_COUNT}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="h-1.5 flex-1 accent-foreground"
              />
              <span className="w-8 text-sm font-medium tabular-nums">{count}</span>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Kinds</Label>
            <div className="flex w-fit gap-0.5 rounded-full bg-muted/70 p-0.5">
              {QUESTION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  aria-pressed={types.includes(type)}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-sm transition-colors',
                    types.includes(type)
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {QUESTION_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          <DifficultyPicker value={difficulty} onChange={setDifficulty} disabled={pending} />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {pending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Make the quiz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
