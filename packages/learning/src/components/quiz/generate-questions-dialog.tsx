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
import { useSections } from '@api/modules/section/section.queries';
import { useGenerateQuestions } from '@api/modules/question/question.queries';
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type QuestionType } from '@play/types';

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
 * The lesson is a choice rather than something the dialog knows, because a quiz
 * may draw on any lesson of its course — the one before it is the common case
 * and only the author knows which. The list is the course's own lessons: a
 * question written from something outside the course would be a question its
 * learners cannot answer.
 *
 * It does not wait for the questions. The run is queued, the dialog closes, and
 * the page shows the run's progress where the questions will appear — which is
 * the only honest thing a dialog can do when the work takes a minute and the
 * request that starts it returns in a moment.
 */
export function GenerateQuestionsDialog({
  contentId,
  spaceId,
  open,
  onOpenChange,
  defaultSourceContentId,
}: {
  contentId: string;
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lesson to preselect, when the page that opened this knows one. */
  defaultSourceContentId?: string;
}) {
  const [sourceContentId, setSourceContentId] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [types, setTypes] = useState<QuestionType[]>([...QUESTION_TYPES]);

  const { data: outline } = useSections(spaceId);
  const generate = useGenerateQuestions(spaceId);

  // Every lesson of the course that has something to write from — a video, or
  // notes. A lesson with neither is a title, and a model given a title writes
  // questions about the title.
  const sources = (outline?.sections ?? []).flatMap((section) =>
    section.contents
      .filter((content) => content.type === 'VIDEO' && (content.videoId || content.notes))
      .map((content) => ({ contentId: content.contentId, title: content.title, sectionTitle: section.title })),
  );

  useEffect(() => {
    if (!open) return;
    setSourceContentId(defaultSourceContentId ?? '');
    setCount(DEFAULT_COUNT);
    setTypes([...QUESTION_TYPES]);
  }, [open, defaultSourceContentId]);

  /**
   * Which lesson the form is on.
   *
   * The state stands for "what the author chose"; when they have not chosen, the
   * first lesson of the course is the answer. It is computed here rather than
   * written into the state when the dialog opens because the course's outline may
   * still be on its way — a dialog that opened onto an empty select and stayed
   * disabled would be a dialog that looked broken for the second the request
   * takes.
   */
  const selected = sourceContentId || sources[0]?.contentId || '';

  function toggleType(type: QuestionType) {
    setTypes((current) => {
      // The last one cannot be turned off: a run asked for no kinds of question
      // is a run that writes none.
      if (current.includes(type)) return current.length === 1 ? current : current.filter((entry) => entry !== type);
      return QUESTION_TYPES.filter((entry) => current.includes(entry) || entry === type);
    });
  }

  async function submit() {
    try {
      await generate.mutateAsync({ contentId, sourceContentId: selected, count, types });
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
            A model reads the lesson you choose and writes questions from it. Every one arrives
            needing verification — nothing it writes is trusted until somebody here has read it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="generation-source">Lesson</Label>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This course has no lesson with a video or notes yet. There is nothing to write
                questions from.
              </p>
            ) : (
              <select
                id="generation-source"
                value={selected}
                onChange={(event) => setSourceContentId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
              >
                {sources.map((source) => (
                  <option key={source.contentId} value={source.contentId}>
                    {source.title} — {source.sectionTitle}
                  </option>
                ))}
              </select>
            )}
          </div>

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
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!selected || generate.isPending}>
            {generate.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            Generate {count} questions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
