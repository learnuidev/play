'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  CircleDashedIcon,
  DownloadIcon,
  GripVerticalIcon,
  HelpCircleIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
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
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
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
import {
  useDeleteQuestion,
  usePlaceQuestion,
  useQuestions,
  useQuestionsAfterGeneration,
  useQuizContent,
  useVerifyQuestion,
  useVerifyQuestions,
} from '@api/modules/question/question.queries';
import { useSections } from '@api/modules/section/section.queries';
import { GenerateQuestionsDialog } from './generate-questions-dialog';
import { ImportQuestionsDialog } from './import-questions-dialog';
import { QuestionDialog } from './question-dialog';
import { downloadTextFile, questionsToCsv, questionsToJson, quizFileName } from '@learning/lib/question-export';
import {
  QUESTION_SOURCE_LABELS,
  QUESTION_STATUS_LABELS,
  QUESTION_TYPE_LABELS,
  type QuizGeneration,
  type QuizQuestion,
} from '@play/types';

/**
 * A quiz: what it asks, who has read it, and the three ways questions arrive.
 *
 * One surface for both apps, and the honest difference between them is
 * `canEdit`. An author gets the whole thing — write, import, generate, reorder,
 * verify, delete; a learner gets a page that says what this is and that taking it
 * is not something Play does yet. A learner is deliberately *not* shown the
 * questions: they carry the answer key, and the API refuses to serve them to
 * anybody who cannot edit the quiz. See `requireQuizAccess`.
 *
 * The shape follows the classroom's other panels: a quiet header of counts and
 * actions, then the list. The one unusual thing is the status — a question
 * written by a machine is a draft until a person reads it, and the page's job is
 * to make that state impossible to miss and cheap to clear.
 */

/** The chip a question's verification state is drawn with. */
function StatusChip({ question }: { question: QuizQuestion }) {
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
function SourceChip({ question, lessonTitle }: { question: QuizQuestion; lessonTitle?: string }) {
  const from = question.sourceContentId ? lessonTitle : undefined;
  const label = QUESTION_SOURCE_LABELS[question.source];

  return (
    <span
      className="shrink-0 text-xs text-muted-foreground"
      title={from ? `${label} from “${from}”` : label}
    >
      {label}
      {from ? ` · ${from}` : ''}
    </span>
  );
}

/** The prompt and its options, with the right answer marked. */
function QuestionBody({ question }: { question: QuizQuestion }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium leading-snug">{question.prompt}</p>

      <ul className="grid gap-0.5 text-xs text-muted-foreground">
        {question.options.map((option) => {
          const correct = question.correctOptionIds.includes(option.id);
          return (
            <li key={option.id} className="flex items-baseline gap-2">
              <span className={cn('w-3 shrink-0 font-medium uppercase', correct && 'text-emerald-600 dark:text-emerald-400')}>
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

/**
 * One question in the list.
 *
 * A sortable row: the handle is the only thing that starts a drag, so a click on
 * the prompt does not pick the question up, and the whole row is not a link —
 * editing is a button, because a question is read far more often than it is
 * changed.
 */
function QuestionRow({
  question,
  index,
  lessonTitle,
  onEdit,
  onVerify,
  onDelete,
  pending,
}: {
  question: QuizQuestion;
  index: number;
  lessonTitle?: string;
  onEdit: (question: QuizQuestion) => void;
  onVerify: (question: QuizQuestion, verified: boolean) => void;
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

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusChip question={question} />
          <span className="text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[question.type]}</span>
          <SourceChip question={question} lessonTitle={lessonTitle} />
        </div>
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
              aria-label={`Actions for this question`}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
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
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(question)}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/** The quiet card a quiz with nothing in it shows, in the app's own voice. */
function NoQuestionsYet({ canEdit, onAdd, onGenerate, onImport }: { canEdit: boolean; onAdd: () => void; onGenerate: () => void; onImport: () => void }) {
  return (
    <div className="grid justify-items-center gap-3 rounded-3xl border border-border/60 bg-card py-14 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <HelpCircleIcon className="size-5" />
      </div>
      <p className="text-base font-semibold tracking-tight">No questions yet</p>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {canEdit
          ? 'Write one, import a spreadsheet, or have a model write a first set from a lesson. Nothing counts as verified until somebody reads it.'
          : 'This quiz has no questions in it yet.'}
      </p>

      {canEdit && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" className="rounded-full" onClick={onGenerate}>
            <SparklesIcon />
            Generate from a lesson
          </Button>
          <Button size="sm" variant="outline" className="rounded-full" onClick={onImport}>
            <UploadIcon />
            Import a file
          </Button>
          <Button size="sm" variant="ghost" className="rounded-full" onClick={onAdd}>
            <PlusIcon />
            Write one
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * What happens while a model is writing.
 *
 * Shown in the place the questions will appear rather than in a toast, because a
 * run takes a minute: a toast is gone before it finishes, and this is the one
 * thing on the page that is changing on its own.
 */
function GenerationBanner({ generation, lessonTitle }: { generation: QuizGeneration; lessonTitle?: string }) {
  const running = generation.status === 'QUEUED' || generation.status === 'RUNNING';
  const from = lessonTitle ? `“${lessonTitle}”` : 'a lesson';

  if (running) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <p className="text-sm">
          Writing {generation.count} question{generation.count === 1 ? '' : 's'} from {from}
          <span className="text-muted-foreground"> — they will appear here.</span>
        </p>
      </div>
    );
  }

  if (generation.status === 'FAILED') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="text-sm">
          <p className="font-medium">The questions could not be written</p>
          <p className="mt-0.5 text-muted-foreground">{generation.error ?? 'The run failed.'}</p>
        </div>
      </div>
    );
  }

  return null;
}

/** The page a learner gets: what this is, and that it cannot be taken yet. */
function NotTakeableYet() {
  return (
    <div className="grid justify-items-center gap-3 rounded-3xl border border-border/60 bg-card py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <HelpCircleIcon className="size-5" />
      </div>
      <p className="text-base font-semibold tracking-tight">This quiz cannot be taken yet</p>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        Quiz questions are written and reviewed in Play Studio. Answering one is not part of Play
        yet, so there is nothing to open here for now.
      </p>
    </div>
  );
}

export function QuizPanel({
  contentId,
  spaceId,
  canEdit = false,
  title,
}: {
  contentId: string;
  spaceId: string;
  /** Whether this reader may change the quiz. A learner may not. */
  canEdit?: boolean;
  /** The quiz's own title, for the export file names. */
  title?: string;
}) {
  const { data: contentData, isLoading: contentLoading } = useQuizContent(contentId);
  const generation = contentData?.content.generation;

  const { data, isLoading } = useQuestions(contentId, canEdit);
  useQuestionsAfterGeneration(contentId, generation);

  const { data: outline } = useSections(spaceId);
  const verify = useVerifyQuestion(contentId);
  const verifyAll = useVerifyQuestions(contentId);
  const place = usePlaceQuestion(contentId);
  const remove = useDeleteQuestion(contentId);

  const [editing, setEditing] = useState<QuizQuestion | undefined>();
  const [editingOpen, setEditingOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState<QuizQuestion | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** The course's own lessons, so a question's source can be named. */
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

  // A question that is being edited may have been verified or deleted elsewhere
  // in the meantime; the row the dialog was opened on is the one it should show.
  useEffect(() => {
    if (!editing || !editingOpen) return;
    const current = questions.find((question) => question.questionId === editing.questionId);
    if (current && current !== editing) setEditing(current);
  }, [questions, editing, editingOpen]);

  async function handleVerify(question: QuizQuestion, verified: boolean) {
    try {
      await verify.mutateAsync({ questionId: question.questionId, verified });
      toast.success(verified ? 'Question verified' : 'Verification taken back');
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

  async function handleDelete(question: QuizQuestion) {
    const confirmed = window.confirm(`Delete this question?\n\n“${question.prompt}”`);
    if (!confirmed) return;

    try {
      await remove.mutateAsync(question.questionId);
      toast.success('Question deleted');
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
   * order out from what the quiz currently holds, so a question added by
   * somebody else while this drag was in flight is not lost by it.
   */
  async function handleDragEnd(event: DragEndEvent) {
    setDragging(null);

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = questions.findIndex((question) => question.questionId === active.id);
    const to = questions.findIndex((question) => question.questionId === over.id);
    if (from === -1 || to === -1) return;

    const index = arrayMove(questions, from, to).findIndex((question) => question.questionId === active.id);

    try {
      await place.mutateAsync({ questionId: String(active.id), index });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder the questions');
    }
  }

  if (!canEdit) return <NotTakeableYet />;

  if (contentLoading || isLoading) {
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
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Export the questions">
                  <DownloadIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => {
                    downloadTextFile(quizFileName(title ?? 'quiz', 'csv'), questionsToCsv(questions), 'text/csv');
                  }}
                >
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    downloadTextFile(quizFileName(title ?? 'quiz', 'json'), questionsToJson(questions), 'application/json');
                  }}
                >
                  Export as JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setImporting(true)}>
            <UploadIcon />
            Import
          </Button>
          <Button variant="outline" size="sm" className="rounded-full" onClick={() => setGenerating(true)}>
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
            Add question
          </Button>
        </div>
      </div>

      {generation && <GenerationBanner generation={generation} lessonTitle={lessonTitles.get(generation.sourceContentId)} />}

      {questions.length === 0 ? (
        <NoQuestionsYet
          canEdit
          onAdd={() => {
            setEditing(undefined);
            setEditingOpen(true);
          }}
          onGenerate={() => setGenerating(true)}
          onImport={() => setImporting(true)}
        />
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
          <SortableContext items={questions.map((question) => question.questionId)} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-2">
              {questions.map((question, index) => (
                <QuestionRow
                  key={question.questionId}
                  question={question}
                  index={index}
                  lessonTitle={question.sourceContentId ? lessonTitles.get(question.sourceContentId) : undefined}
                  pending={pending}
                  onEdit={(target) => {
                    setEditing(target);
                    setEditingOpen(true);
                  }}
                  onVerify={handleVerify}
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

      <QuestionDialog contentId={contentId} question={editing} open={editingOpen} onOpenChange={setEditingOpen} />
      <GenerateQuestionsDialog
        contentId={contentId}
        spaceId={spaceId}
        open={generating}
        onOpenChange={setGenerating}
      />
      <ImportQuestionsDialog contentId={contentId} spaceId={spaceId} open={importing} onOpenChange={setImporting} />
    </div>
  );
}
