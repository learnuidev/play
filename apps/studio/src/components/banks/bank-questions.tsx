'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { BookOpenIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';
import { useBankQuestions, useDeleteQuestion, useVerifyQuestion } from '@api/modules/question/question.queries';
import { contentKeys } from '@api/modules/content/content.queries';
import { useSpaces } from '@api/modules/space/space.queries';
import { api } from '@api/lib/api';
import { QuestionBody, QuestionFacts } from '@learning/components/quiz/question-parts';
import type { QuizQuestion } from '@play/types';

/**
 * A bank's questions, grouped by the lesson each one is about.
 *
 * The grouping is the whole reason questions carry a lesson: a bank is a list
 * somebody works down, and "is this still true?" is a question about a lesson
 * rather than about a bank's fortieth row. So the lessons come first, each with
 * what it holds under it, and a lesson somebody has since deleted takes its
 * questions with it — the cascade is the API's, and this list simply never sees
 * one.
 *
 * Rows are ordered by the bank's own order inside a lesson, which is the order
 * they were written in: a bank is a library rather than a sequence, and the order
 * that matters to a learner belongs to the quiz that asks them.
 */
export function BankQuestions({
  orgId,
  bankId,
  canEdit,
  onEdit,
}: {
  orgId: string;
  bankId: string;
  canEdit: boolean;
  onEdit: (question: QuizQuestion) => void;
}) {
  const { data, isLoading, isError, error } = useBankQuestions(bankId);
  const verify = useVerifyQuestion(bankId);
  const remove = useDeleteQuestion(bankId);

  const { data: spacesData } = useSpaces(orgId);
  const questions = data?.questions ?? [];

  /**
   * The lessons this bank's questions are about, by name.
   *
   * Read from the lessons themselves rather than by walking every course the
   * organization has: a bank holds questions about a handful of lessons, and
   * those are the only titles this list needs. `useQueries` rather than a hook
   * in a loop, because the number of lessons changes as the page loads and a
   * changing number of hooks is a render React refuses.
   */
  const lessonIds = useMemo(
    () => [...new Set(questions.map((question) => question.lessonContentId))],
    [questions],
  );

  const lessonRows = useQueries({
    queries: lessonIds.map((lessonContentId) => ({
      queryKey: contentKeys.detail(lessonContentId),
      queryFn: () => api.getContent(lessonContentId),
      enabled: Boolean(lessonContentId),
    })),
  });

  const lessonTitles = useMemo(() => {
    const titles = new Map<string, { title: string; course: string }>();
    lessonIds.forEach((lessonContentId, index) => {
      const content = lessonRows[index]?.data?.content;
      if (!content) return;
      const course = spacesData?.spaces.find((space) => space.spaceId === content.spaceId)?.title ?? '';
      titles.set(lessonContentId, { title: content.title, course });
    });
    return titles;
  }, [lessonIds, lessonRows, spacesData]);

  /** The bank's questions, in the order they were written, grouped by lesson. */
  const groups = useMemo(() => {
    const byLesson = new Map<string, QuizQuestion[]>();
    for (const question of questions) {
      const list = byLesson.get(question.lessonContentId);
      if (list) list.push(question);
      else byLesson.set(question.lessonContentId, [question]);
    }
    return [...byLesson.entries()];
  }, [questions]);

  async function handleVerify(question: QuizQuestion, verified: boolean) {
    try {
      await verify.mutateAsync({ questionId: question.questionId, verified });
      toast.success(
        verified ? 'Question verified' : 'Verification taken back',
        { description: 'It is the same question in every quiz that asks it.' },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the verification');
    }
  }

  async function handleDelete(question: QuizQuestion) {
    const confirmed = window.confirm(
      `Delete this question from the bank?\n\n“${question.prompt}”\n\nEvery quiz that asks it loses it. This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      const { removedFrom } = await remove.mutateAsync(question.questionId);
      toast.success(
        'Question deleted' + (removedFrom > 1 ? ` — it was asked by ${removedFrom} quizzes` : ''),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the question');
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-3">
        <div className="h-20 animate-pulse rounded-2xl bg-muted/50" />
        <div className="h-20 animate-pulse rounded-2xl bg-muted/50" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <p className="font-medium">This bank could not be read</p>
        <p className="mt-0.5 text-muted-foreground">
          {error instanceof Error ? error.message : 'Something went wrong reading it.'}
        </p>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="grid justify-items-center gap-2 rounded-3xl border border-border/60 bg-card py-14 text-center">
        <p className="text-base font-semibold tracking-tight">Nothing in this bank yet</p>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Write a question, import a spreadsheet, or have a model write a first set from one of the
          organization&rsquo;s lessons.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {groups.map(([lessonContentId, items]) => {
        const lesson = lessonTitles.get(lessonContentId);
        return (
          <section key={lessonContentId} className="grid gap-2">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <BookOpenIcon className="size-4 text-muted-foreground" />
                {lesson?.title ?? 'A lesson that has since been deleted'}
              </h3>
              {lesson?.course && (
                <span className="text-xs text-muted-foreground">{lesson.course}</span>
              )}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {items.length} question{items.length === 1 ? '' : 's'}
              </span>
            </header>

            <ul className="grid gap-2">
              {items.map((question) => (
                <li
                  key={question.questionId}
                  className="group/question flex items-start gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <QuestionBody question={question} />
                    <QuestionFacts question={question} />
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant={question.status === 'VERIFIED' ? 'ghost' : 'outline'}
                      size="sm"
                      className="h-7 rounded-full px-2.5 text-xs"
                      disabled={!canEdit || verify.isPending}
                      onClick={() => handleVerify(question, question.status !== 'VERIFIED')}
                    >
                      {question.status === 'VERIFIED' ? 'Unverify' : 'Verify'}
                    </Button>

                    {canEdit && (
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
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDelete(question)}
                          >
                            <Trash2Icon />
                            Delete from the bank
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
