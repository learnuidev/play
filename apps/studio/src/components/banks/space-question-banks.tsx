'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRightIcon, HelpCircleIcon, PlusIcon, SparklesIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { useSections } from '@api/modules/section/section.queries';
import {
  useSpaceQuestions,
  useVerifySpaceQuestion,
} from '@api/modules/question/question.queries';
import { BankDialog } from './bank-dialog';
import { GenerateQuestionsDialog } from '@learning/components/quiz/generate-questions-dialog';
import { QuestionBody, QuestionFacts } from '@learning/components/quiz/question-parts';
import type { QuizQuestion } from '@play/types';

/**
 * A course's questions, grouped by the lesson each one is about.
 *
 * The tab exists because "what has been written for this course" is a question
 * about a *course*, and neither of the other two pages answers it: a bank's page
 * is organization-wide and a quiz's page is only what that quiz asks. So this is
 * every question about this course's lessons, from every bank — one read, since
 * the table is indexed by the lesson's course.
 *
 * Every lesson appears, including the ones with nothing written about them yet.
 * That is the view an author actually needs: a list of only the finished lessons
 * is a list that cannot tell you what is left. A lesson with no questions offers
 * to have some written, which is where an author notices.
 *
 * The questions themselves are the bank's — a question is about a lesson
 * wherever it is asked — so this page reads and verifies; writing, importing and
 * editing happen in the bank, and every row says which one it came from.
 */
export function SpaceQuestionBanks({
  orgId,
  spaceId,
  canEdit,
}: {
  orgId: string;
  spaceId: string;
  canEdit: boolean;
}) {
  const { data, isLoading, isError, error } = useSpaceQuestions(spaceId);
  const { data: outline } = useSections(spaceId);
  const verify = useVerifySpaceQuestion(spaceId);

  const [generatingFor, setGeneratingFor] = useState<{ contentId: string; title: string } | null>(null);

  const questions = data?.questions ?? [];
  const needsVerification = data?.needsVerification ?? 0;

  /** The course's lessons in their own order, each with the questions about it. */
  const lessons = useMemo(() => {
    const byLesson = new Map<string, QuizQuestion[]>();
    for (const question of questions) {
      const list = byLesson.get(question.lessonContentId);
      if (list) list.push(question);
      else byLesson.set(question.lessonContentId, [question]);
    }

    return (outline?.sections ?? []).flatMap((section) =>
      section.contents
        .filter((content) => content.type === 'VIDEO')
        .map((content) => ({
          contentId: content.contentId,
          title: content.title,
          sectionTitle: section.title,
          questions: byLesson.get(content.contentId) ?? [],
        })),
    );
  }, [outline, questions]);

  const lessonsWithQuestions = lessons.filter((lesson) => lesson.questions.length > 0).length;

  async function handleVerify(question: QuizQuestion, verified: boolean) {
    try {
      await verify.mutateAsync({ questionId: question.questionId, verified });
      toast.success(verified ? 'Question verified' : 'Verification taken back', {
        description: 'It is the same question in every quiz that asks it.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the verification');
    }
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <p className="font-medium">This course&rsquo;s questions could not be read</p>
        <p className="mt-0.5 text-muted-foreground">
          {error instanceof Error ? error.message : 'Something went wrong reading them.'}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-9 w-72 rounded-full" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{questions.length}</span> question
          {questions.length === 1 ? '' : 's'} about{' '}
          <span className="font-medium tabular-nums text-foreground">{lessonsWithQuestions}</span> of{' '}
          {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
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
          <Button variant="ghost" size="sm" className="rounded-full" asChild>
            <Link href={`/o/${orgId}/question-banks`}>
              All banks
              <ArrowUpRightIcon />
            </Link>
          </Button>
          {canEdit && (
            <BankDialog
              orgId={orgId}
              trigger={
                <Button size="sm" className="rounded-full">
                  <PlusIcon />
                  New bank
                </Button>
              }
            />
          )}
        </div>
      </div>

      {lessons.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-3xl border border-border/60 bg-card py-14 text-center">
          <p className="text-base font-semibold tracking-tight">This course has no lessons yet</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            A question is about a lesson, so there is nothing to write questions about until the
            course has some.
          </p>
        </div>
      ) : (
        <div className="grid gap-5">
          {lessons.map((lesson) => (
            <section key={lesson.contentId} className="grid gap-2">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
                  {lesson.title}
                </h3>
                <span className="text-xs text-muted-foreground">{lesson.sectionTitle}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                  {lesson.questions.length === 0
                    ? 'no questions yet'
                    : `${lesson.questions.length} question${lesson.questions.length === 1 ? '' : 's'}`}
                </span>
              </header>

              {lesson.questions.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border/60 px-4 py-3">
                  <HelpCircleIcon className="size-4 shrink-0 text-muted-foreground/60" />
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    Nothing has been written about this lesson.
                  </p>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => setGeneratingFor({ contentId: lesson.contentId, title: lesson.title })}
                    >
                      <SparklesIcon />
                      Generate
                    </Button>
                  )}
                </div>
              ) : (
                <ul className="grid gap-2">
                  {lesson.questions.map((question) => (
                    <li
                      key={question.questionId}
                      className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <QuestionBody question={question} />
                        <QuestionFacts
                          question={question}
                          extra={
                            <Link
                              href={`/o/${orgId}/question-banks/${question.bankId}`}
                              className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                            >
                              in its bank
                            </Link>
                          }
                        />
                      </div>

                      <Button
                        type="button"
                        variant={question.status === 'VERIFIED' ? 'ghost' : 'outline'}
                        size="sm"
                        className="h-7 shrink-0 rounded-full px-2.5 text-xs"
                        disabled={!canEdit || verify.isPending}
                        onClick={() => handleVerify(question, question.status !== 'VERIFIED')}
                      >
                        {question.status === 'VERIFIED' ? 'Unverify' : 'Verify'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {canEdit && generatingFor && (
        <GenerateQuestionsDialog
          orgId={orgId}
          spaceId={spaceId}
          lessonContentId={generatingFor.contentId}
          open={Boolean(generatingFor)}
          onOpenChange={(open) => {
            if (!open) setGeneratingFor(null);
          }}
        />
      )}
    </div>
  );
}
