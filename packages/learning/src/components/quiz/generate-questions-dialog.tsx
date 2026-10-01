'use client';

import { useEffect, useState } from 'react';
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
import { Label } from '@ui/components/ui/label';
import { useGenerateQuestions } from '@api/modules/question/question.queries';
import { BankPicker } from './bank-picker';
import { DifficultyPicker } from './difficulty-picker';
import { LessonPicker } from './lesson-picker';
import {
  DEFAULT_QUESTION_DIFFICULTY,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type QuestionDifficulty,
  type QuestionType,
} from '@play/types';

/**
 * How many questions are written in one run.
 *
 * Ten by default rather than five: a run costs a model call either way, and an
 * author who asked for three questions will ask again, which is a second call
 * and a second wait. Twenty is the API's ceiling — past it the model's answer
 * stops fitting in one response and the questions start being cut off mid-list.
 */
const DEFAULT_COUNT = 10;
const MAX_COUNT = 20;

/**
 * Asking a model to write questions from a lesson.
 *
 * Four things are chosen, and each is required by the model rather than by the
 * form: **the bank** the questions are written into (where questions live),
 * **the lesson** they are about (which is also what they are written from, and
 * what decides which courses' quizzes may ask them), how many of which kind, and
 * **how hard** — one level for the whole run, because the level is the
 * instruction rather than a label applied afterwards. An author who wants a set
 * at two levels asks twice.
 *
 * It does not wait for the questions. The run is queued, the dialog closes, and
 * the page shows the run's progress where the questions will appear — which is
 * the only honest thing a dialog can do when the work takes a minute and the
 * request that starts it returns in a moment.
 */
export function GenerateQuestionsDialog({
  orgId,
  bankId,
  spaceId,
  lessonContentId,
  addToContentId,
  open,
  onOpenChange,
  onStarted,
}: {
  orgId: string;
  /** The bank to write into. Omit to let the author choose one. */
  bankId?: string;
  /** The course whose lessons are on offer. Omit to let the author choose one. */
  spaceId?: string;
  /** The lesson to start on, when the page that opened this knows one. */
  lessonContentId?: string;
  /** A quiz to add what is written to, when the run was started from one. */
  addToContentId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bank the run was started in, so the page can watch it. */
  onStarted?: (bankId: string) => void;
}) {
  const [pickedBankId, setPickedBankId] = useState('');
  const [lesson, setLesson] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [types, setTypes] = useState<QuestionType[]>([...QUESTION_TYPES]);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>(DEFAULT_QUESTION_DIFFICULTY);

  const generate = useGenerateQuestions();
  const destinationBankId = bankId ?? pickedBankId;

  useEffect(() => {
    if (!open) return;
    setPickedBankId('');
    setLesson(lessonContentId ?? '');
    setCount(DEFAULT_COUNT);
    setTypes([...QUESTION_TYPES]);
    setDifficulty(DEFAULT_QUESTION_DIFFICULTY);
  }, [open, lessonContentId]);

  function toggleType(type: QuestionType) {
    setTypes((current) => {
      // The last one cannot be turned off: a run asked for no kinds of question
      // is a run that writes none.
      if (current.includes(type)) return current.length === 1 ? current : current.filter((entry) => entry !== type);
      return QUESTION_TYPES.filter((entry) => current.includes(entry) || entry === type);
    });
  }

  async function submit() {
    if (!destinationBankId || !lesson) return;

    try {
      await generate.mutateAsync({
        bankId: destinationBankId,
        lessonContentId: lesson,
        count,
        types,
        difficulty,
        ...(addToContentId ? { addToContentId } : {}),
      });
      onStarted?.(destinationBankId);
      toast.success('Writing questions…', {
        description: 'They will appear here. You can leave this page.',
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the generation');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate questions</DialogTitle>
          <DialogDescription>
            A model reads the lesson you choose and writes questions about it into the bank you
            choose. Every one arrives needing verification — nothing it writes is trusted until
            somebody here has read it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!bankId && (
            <BankPicker orgId={orgId} value={pickedBankId} onChange={setPickedBankId} disabled={generate.isPending} />
          )}

          <LessonPicker
            orgId={orgId}
            spaceId={spaceId}
            value={lesson}
            onChange={setLesson}
            disabled={generate.isPending}
          />

          <div className="grid gap-2">
            <Label htmlFor="generation-count">How many</Label>
            <div className="flex items-center gap-3">
              <input
                id="generation-count"
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

          <DifficultyPicker value={difficulty} onChange={setDifficulty} disabled={generate.isPending} />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={submit}
            disabled={!destinationBankId || !lesson || generate.isPending}
          >
            {generate.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Generate {count} questions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
