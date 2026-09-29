'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  DownloadIcon,
  GripVerticalIcon,
  HelpCircleIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { Button } from '@ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useSections } from '@api/modules/section/section.queries';
import { useQueryClient } from '@tanstack/react-query';
import {
  quizQuestionKeys,
  useDeleteQuestion,
  useDismissGeneration,
  usePlaceQuizQuestion,
  useQuestionBank,
  useQuizQuestions,
  useRemoveQuizQuestion,
  useVerifyQuestion,
  useVerifyQuizQuestions,
} from '@api/modules/question/question.queries';
import { AddFromBankDialog } from './add-from-bank-dialog';
import { GenerateQuestionsDialog } from './generate-questions-dialog';
import { QuestionDialog } from './question-dialog';
import { QuestionBody, QuestionFacts } from './question-parts';
import { QuizTaking } from './quiz-taking';
import { downloadTextFile, questionsToCsv, questionsToJson, quizFileName } from '@learning/lib/question-export';
import type { QuizGeneration, QuizQuestion } from '@play/types';

/**
 * A quiz, as its author sees it, or as the learner sitting it does.
 *
 * Those are two screens behind one component, and `canEdit` is which one it is.
 * An author gets what is below: the questions the quiz asks, in the order it
 * asks them, where each one came from, and everything that edits, verifies or
 * reorders them. A learner gets `QuizTaking` — the same questions without the
 * answers, and what they scored. It is not a permission check on the client: the
 * two routes behind them authorize differently and hand out different things,
 * and the fact that nothing about writing a quiz belongs on the page somebody is
 * sitting is the reason the split is here rather than deeper in.
 *
 * What the authoring half is built on: a quiz does not own its questions. They
 * live in **banks**, each one is about a **lesson**, and a quiz holds references
 * — so the same question can be asked by a retake and by next term's version of
 * the course. Everything this page does follows from that:
 *
 * - **removing** a question takes it out of this quiz and leaves it where it
 *   lives; **deleting** it is a different thing, offered separately, and it
 *   takes the question out of every quiz asking it;
 * - **editing** one changes it everywhere, which is why the row says so before
 *   the editor opens;
 * - **verifying** one verifies the question, once, whichever page it is done
 *   from — that is the whole point of a shared question being reviewed once, and
 *   it is also what puts a question in front of a learner: the paper holds back
 *   everything nobody has read.
 */

/** One question in the quiz, draggable because the order is the quiz's. */
function QuizQuestionRow({
  question,
  index,
  lessonTitle,
  bankLabel,
  onEdit,
  onVerify,
  onRemove,
  onDelete,
  pending,
}: {
  question: QuizQuestion;
  index: number;
  lessonTitle?: string;
  bankLabel?: string;
  onEdit: (question: QuizQuestion) => void;
  onVerify: (question: QuizQuestion, verified: boolean) => void;
  onRemove: (question: QuizQuestion) => void;
  onDelete: (question: QuizQuestion) => void;
  pending: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.questionId,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/question flex items-start gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3',
        isDragging && 'opacity-40',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder: ${question.prompt}`}
        className="mt-1 shrink-0 cursor-grab text-muted-foreground/40 transition-colors hover:text-foreground active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-4" />
      </button>

      <span className="mt-0.5 w-5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground/60">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <QuestionBody question={question} />

        <QuestionFacts
          question={question}
          extra={
            <span className="text-xs text-muted-foreground" title="The lesson this question is about">
              {lessonTitle ?? 'A lesson'}
              {bankLabel ? ` · ${bankLabel}` : ''}
            </span>
          }
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant={question.status === 'VERIFIED' ? 'ghost' : 'outline'}
          size="sm"
          className="h-7 rounded-full px-2.5 text-xs"
          disabled={pending}
          onClick={() => onVerify(question, question.status !== 'VERIFIED')}
        >
          {question.status === 'VERIFIED' ? 'Unverify' : 'Verify'}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground/50 transition-colors hover:text-foreground"
              aria-label="Actions for this question"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onEdit(question)}>
              <PencilIcon />
              Edit question
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onVerify(question, question.status !== 'VERIFIED')}
              disabled={pending}
            >
              <BadgeCheckIcon />
              {question.status === 'VERIFIED' ? 'Take verification back' : 'Mark as verified'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onRemove(question)}>
              Remove from this quiz
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(question)}
            >
              <Trash2Icon />
              Delete from its bank
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/** What happens while a model is writing. */
function GenerationBanner({
  generation,
  lessonTitle,
  onRetry,
  onDismiss,
}: {
  generation: QuizGeneration;
  lessonTitle?: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const running = generation.status === 'QUEUED' || generation.status === 'RUNNING';
  const from = lessonTitle ? `“${lessonTitle}”` : 'a lesson';

  if (running) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <p className="text-sm">
          Writing {generation.count} question{generation.count === 1 ? '' : 's'} from {from}
          <span className="text-muted-foreground">
            {' '}
            into their bank — they are added here when they arrive.
          </span>
        </p>
      </div>
    );
  }

  if (generation.status === 'FAILED') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">The questions could not be written</p>
          <p className="mt-0.5 text-muted-foreground">{generation.error ?? 'The run failed.'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 rounded-full px-2.5 text-xs" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" className="h-7 rounded-full px-2.5 text-xs" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

/**
 * A quiz, with the authoring controls when the reader may change it and the
 * paper when they may not. See the file's own note on the two screens.
 */
export function QuizPanel({
  contentId,
  spaceId,
  orgId,
  canEdit = false,
  title,
}: {
  contentId: string;
  spaceId: string;
  /** The organization whose banks the pickers offer. Studio only. */
  orgId?: string;
  /** Whether this reader may change the quiz. A learner may not. */
  canEdit?: boolean;
  /** The quiz's own title, for the export file names. */
  title?: string;
}) {
  const { data, isLoading } = useQuizQuestions(contentId, canEdit);

  const qc = useQueryClient();
  const verify = useVerifyQuestion();
  const verifyAll = useVerifyQuizQuestions(contentId);
  const place = usePlaceQuizQuestion(contentId);
  const remove = useRemoveQuizQuestion(contentId);
  const deleteQuestion = useDeleteQuestion();

  const [editing, setEditing] = useState<QuizQuestion | undefined>();
  const [editingOpen, setEditingOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState<QuizQuestion | null>(null);

  /**
   * The bank a generation was started in from this page.
   *
   * A run lives on the bank, not on the quiz — questions are written into banks
   * and only *then* added to the quiz — so a page that wants to show the run
   * happening has to remember which bank it asked. It is kept for the life of the
   * page, because a run outlives the dialog that started it.
   */
  const [runBankId, setRunBankId] = useState('');
  const { data: runBank } = useQuestionBank(runBankId);
  const generation = runBank?.bank.generation;
  const dismissGeneration = useDismissGeneration(runBankId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** The course's own lessons, so every row can name the lesson it is about. */
  const { data: outline } = useSections(spaceId);
  const lessonTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const section of outline?.sections ?? []) {
      for (const content of section.contents) titles.set(content.contentId, content.title);
    }
    return titles;
  }, [outline]);

  const questions = data?.questions ?? [];
  const needsVerification = data?.needsVerification ?? 0;
  const pending = verify.isPending || verifyAll.isPending || place.isPending || remove.isPending;

  /**
   * The questions a finished run wrote, fetched once they are there.
   *
   * The run writes into a bank and then adds what it wrote to this quiz, so the
   * quiz's own list is the thing that changes — and it changes a moment after
   * the run stops running, which is why this waits for that rather than polling
   * the questions themselves.
   */
  const runRunning =
    generation?.status === 'QUEUED' || generation?.status === 'RUNNING';
  const seenRunning = useRef(false);

  useEffect(() => {
    if (runRunning) {
      seenRunning.current = true;
      return;
    }
    if (!seenRunning.current) return;
    seenRunning.current = false;

    qc.invalidateQueries({ queryKey: quizQuestionKeys.list(contentId) });
  }, [runRunning, contentId, qc]);

  // A question being edited may have been verified or removed elsewhere in the
  // meantime; the row the dialog was opened on is the one it should show.
  useEffect(() => {
    if (!editing || !editingOpen) return;
    const current = questions.find((question) => question.questionId === editing.questionId);
    if (current && current !== editing) setEditing(current);
  }, [questions, editing, editingOpen]);

  async function handleVerify(question: QuizQuestion, verified: boolean) {
    try {
      await verify.mutateAsync({ questionId: question.questionId, verified });
      qc.invalidateQueries({ queryKey: quizQuestionKeys.list(contentId) });
      toast.success(verified ? 'Question verified' : 'Verification taken back', {
        description: 'It is the same question in every quiz that asks it.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the verification');
    }
  }

  async function handleVerifyAll() {
    try {
      const result = await verifyAll.mutateAsync(undefined);
      toast.success(`Verified ${result.verified} question${result.verified === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not verify the questions');
    }
  }

  /** Out of this quiz only — the question stays in its bank. */
  async function handleRemove(question: QuizQuestion) {
    const confirmed = window.confirm(
      `Remove this question from the quiz?\n\n“${question.prompt}”\n\nIt stays in its bank, and other quizzes asking it are untouched.`,
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(question.questionId);
      toast.success('Removed from this quiz');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the question');
    }
  }

  /** Out of its bank — and out of every quiz asking it. */
  async function handleDelete(question: QuizQuestion) {
    const confirmed = window.confirm(
      `Delete this question from its bank?\n\n“${question.prompt}”\n\nEvery quiz that asks it loses it. This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      const { removedFrom } = await deleteQuestion.mutateAsync(question.questionId);
      toast.success(
        'Question deleted' +
          (removedFrom > 1 ? ` — it was asked by ${removedFrom} quizzes` : ''),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the question');
    }
  }

  /**
   * A drag that ended: the place it landed is where the row now sits.
   *
   * `arrayMove` is what the list looks like afterwards, so the index of the
   * moved row *in the result* is the index the server is given — which is the
   * one number that means the same thing on both sides. The server works the
   * order out from what the quiz currently asks, so a question added by somebody
   * else while this drag was in flight is not lost by it.
   */
  async function handleDragEnd(event: DragEndEvent) {
    setDragging(null);

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = questions.findIndex((question) => question.questionId === active.id);
    const to = questions.findIndex((question) => question.questionId === over.id);
    if (from === -1 || to === -1) return;

    const index = arrayMove(questions, from, to).findIndex(
      (question) => question.questionId === active.id,
    );

    try {
      await place.mutateAsync({ questionId: String(active.id), index });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder the questions');
    }
  }

  if (!canEdit) return <QuizTaking contentId={contentId} spaceId={spaceId} />;

  if (isLoading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-9 w-64 rounded-full" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Counts and actions. The verification state is said here as well as on
          every row, because it is the answer to "is this quiz finished". */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{questions.length}</span> question
          {questions.length === 1 ? '' : 's'}
          {needsVerification > 0 && (
            <>
              {' · '}
              <span className="font-medium text-amber-700 tabular-nums dark:text-amber-400">
                {needsVerification}
              </span>{' '}
              need{needsVerification === 1 ? 's' : ''} verification
            </>
          )}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {needsVerification > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={pending}
              onClick={handleVerifyAll}
            >
              <BadgeCheckIcon />
              Verify all {needsVerification}
            </Button>
          )}

          {questions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label="Export the questions"
                >
                  <DownloadIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => {
                    downloadTextFile(
                      quizFileName(title ?? 'quiz', 'csv'),
                      questionsToCsv(questions),
                      'text/csv',
                    );
                  }}
                >
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    downloadTextFile(
                      quizFileName(title ?? 'quiz', 'json'),
                      questionsToJson(questions),
                      'application/json',
                    );
                  }}
                >
                  Export as JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Authoring needs the organization: the bank picker reads its banks,
              the lesson picker its courses. A page that renders this for an
              editor without one gets buttons that cannot work — so they are not
              drawn, and the panel says why. */}
          {orgId ? (
            <>
              <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setPicking(true)}>
                <PlusIcon />
                Add from a bank
              </Button>
              <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setGenerating(true)}>
                <SparklesIcon />
                Generate
              </Button>
              <Button
                size="sm"
                className="rounded-full"
                onClick={() => {
                  setEditing(undefined);
                  setEditingOpen(true);
                }}
              >
                <PlusIcon />
                Write one
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Open this quiz from its course to write questions into it.
            </p>
          )}
        </div>
      </div>

      {generation && (
        <GenerationBanner
          generation={generation}
          lessonTitle={lessonTitles.get(generation.lessonContentId)}
          onRetry={() => setGenerating(true)}
          onDismiss={() => dismissGeneration.mutate()}
        />
      )}

      {questions.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-3xl border border-border/60 bg-card py-14 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <HelpCircleIcon className="size-5" />
          </div>
          <p className="text-base font-semibold tracking-tight">No questions yet</p>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Pick questions out of a bank, write one, or have a model write a first set from a lesson.
            Nothing counts as verified until somebody reads it.
          </p>
          {orgId && (
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" className="rounded-full" onClick={() => setPicking(true)}>
                <PlusIcon />
                Add from a bank
              </Button>
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => setGenerating(true)}>
                <SparklesIcon />
                Generate from a lesson
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  setEditing(undefined);
                  setEditingOpen(true);
                }}
              >
                Write one
              </Button>
            </div>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={(event: DragStartEvent) =>
            setDragging(questions.find((question) => question.questionId === event.active.id) ?? null)
          }
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <SortableContext
            items={questions.map((question) => question.questionId)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="grid gap-2">
              {questions.map((question, index) => (
                <QuizQuestionRow
                  key={question.questionId}
                  question={question}
                  index={index}
                  lessonTitle={lessonTitles.get(question.lessonContentId)}
                  pending={pending}
                  onEdit={(target) => {
                    setEditing(target);
                    setEditingOpen(true);
                  }}
                  onVerify={handleVerify}
                  onRemove={handleRemove}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          </SortableContext>

          {/* The row is drawn by the browser's own drag image otherwise, which
              loses the card's shape the moment it leaves the list. */}
          <DragOverlay>
            {dragging && (
              <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-lg">
                <QuestionBody question={dragging} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {orgId && (
        <>
          <QuestionDialog
            orgId={orgId}
            bankId={editing?.bankId}
            spaceId={spaceId}
            lessonContentId={editing?.lessonContentId}
            question={editing}
            addToContentId={contentId}
            open={editingOpen}
            onOpenChange={setEditingOpen}
          />
          <AddFromBankDialog
            orgId={orgId}
            contentId={contentId}
            spaceId={spaceId}
            open={picking}
            onOpenChange={setPicking}
          />
          <GenerateQuestionsDialog
            orgId={orgId}
            spaceId={spaceId}
            addToContentId={contentId}
            open={generating}
            onOpenChange={setGenerating}
            onStarted={setRunBankId}
          />
        </>
      )}
    </div>
  );
}
