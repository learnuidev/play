'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  DownloadIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  UploadIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@api/modules/organization/organization.queries';
import {
  useBankQuestions,
  useDismissGeneration,
  useQuestionBank,
  useQuestionsAfterGeneration,
  useVerifyQuestions,
} from '@api/modules/question/question.queries';
import { Button } from '@ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';
import { Skeleton } from '@ui/components/ui/skeleton';
import { BankDialog } from '@/components/banks/bank-dialog';
import { BankQuestions } from '@/components/banks/bank-questions';
import { GenerateQuestionsDialog } from '@learning/components/quiz/generate-questions-dialog';
import { ImportQuestionsDialog } from '@learning/components/quiz/import-questions-dialog';
import { QuestionDialog } from '@learning/components/quiz/question-dialog';
import {
  downloadTextFile,
  questionsToCsv,
  questionsToJson,
  quizFileName,
} from '@learning/lib/question-export';
import type { QuizQuestion } from '@play/types';
import { QUESTION_DIFFICULTY_LABELS } from '@play/types';

/**
 * One bank: its questions, grouped by the lesson each is about.
 *
 * The page is a library rather than a list of decisions, so the actions are the
 * three ways a question arrives — written, imported, generated — plus what a
 * reviewer needs: how much nobody has read, and one button to accept a batch
 * once they have.
 *
 * A generation is the one thing here that happens without anybody doing
 * anything, so it is the one thing the page polls for: the run is recorded on
 * the bank itself, and this reads the bank.
 */
export default function QuestionBankPage() {
  const { orgId, bankId } = useParams<{ orgId: string; bankId: string }>();
  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== 'VIEWER' : false;

  const { data: bankData } = useQuestionBank(bankId);
  const { data, isLoading } = useBankQuestions(bankId);
  const verifyAll = useVerifyQuestions(bankId);
  const dismiss = useDismissGeneration(bankId);

  const bank = bankData?.bank ?? data?.bank;
  const generation = bank?.generation;
  useQuestionsAfterGeneration(bankId, generation);

  const [writing, setWriting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<QuizQuestion | undefined>();

  const questions = data?.questions ?? [];
  const needsVerification = data?.needsVerification ?? 0;
  const running = generation?.status === 'QUEUED' || generation?.status === 'RUNNING';

  async function handleVerifyAll() {
    try {
      const result = await verifyAll.mutateAsync(undefined);
      toast.success(`Verified ${result.verified} question${result.verified === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not verify the questions');
    }
  }

  if (isLoading || !bank) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 pb-4">
      <Link
        href={`/o/${orgId}/question-banks`}
        className="-mb-2 inline-flex w-fit items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Question banks
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {bank.name}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{questions.length}</span>{' '}
            question{questions.length === 1 ? '' : 's'}
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
          {bank.description && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {bank.description}
            </p>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {needsVerification > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                disabled={verifyAll.isPending}
                onClick={handleVerifyAll}
              >
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
                    onClick={() =>
                      downloadTextFile(quizFileName(bank.name, 'csv'), questionsToCsv(questions), 'text/csv')
                    }
                  >
                    Export as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      downloadTextFile(
                        quizFileName(bank.name, 'json'),
                        questionsToJson(questions),
                        'application/json',
                      )
                    }
                  >
                    Export as JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <BankDialog
              orgId={orgId}
              bank={bank}
              trigger={
                <Button variant="ghost" size="sm" className="rounded-full">
                  Edit
                </Button>
              }
            />
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
                setWriting(true);
              }}
            >
              <PlusIcon />
              Write a question
            </Button>
          </div>
        )}
      </header>

      {generation && running && (
        <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
          <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <p className="text-sm">
            Writing {generation.count}{' '}
            {generation.difficulty
              ? `${QUESTION_DIFFICULTY_LABELS[generation.difficulty].toLowerCase()} `
              : ''}
            question{generation.count === 1 ? '' : 's'}
            <span className="text-muted-foreground"> — they will appear here.</span>
          </p>
        </div>
      )}

      {generation?.status === 'FAILED' && (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">The questions could not be written</p>
            <p className="mt-0.5 text-muted-foreground">{generation.error ?? 'The run failed.'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 rounded-full px-2.5 text-xs" onClick={() => setGenerating(true)}>
              Try again
            </Button>
            <Button variant="ghost" size="sm" className="h-7 rounded-full px-2.5 text-xs" onClick={() => dismiss.mutate()}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <BankQuestions
        orgId={orgId}
        bankId={bankId}
        canEdit={canEdit}
        onEdit={(question) => {
          setEditing(question);
          setWriting(true);
        }}
      />

      <QuestionDialog
        orgId={orgId}
        bankId={bankId}
        question={editing}
        open={writing}
        onOpenChange={setWriting}
      />
      <ImportQuestionsDialog orgId={orgId} bankId={bankId} open={importing} onOpenChange={setImporting} />
      <GenerateQuestionsDialog orgId={orgId} bankId={bankId} open={generating} onOpenChange={setGenerating} />
    </div>
  );
}
