'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { HelpCircleIcon, PlusIcon } from 'lucide-react';
import { useOrganization } from '@api/modules/organization/organization.queries';
import { useDeleteQuestionBank, useQuestionBanks } from '@api/modules/question/question.queries';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { toast } from 'sonner';
import { PageCard, EmptyState } from '@/components/shell/page-card';
import { BankDialog } from '@/components/banks/bank-dialog';
import { formatDate } from '@ui/lib/utils';

/**
 * An organization's question banks.
 *
 * Beside Videos and Spaces in the organization's bar, and for the same reason:
 * a bank is material the organization owns rather than one course's business.
 * The questions in one are about *lessons*, so a bank serves whichever courses
 * teach them — which is what makes a question worth writing carefully once.
 */
export default function QuestionBanksPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: orgData } = useOrganization(orgId);
  const canEdit = orgData ? orgData.organization.role !== 'VIEWER' : false;

  const { data, isLoading } = useQuestionBanks(orgId);
  const remove = useDeleteQuestionBank(orgId);
  const banks = data?.banks ?? [];

  async function handleDelete(bankId: string, name: string, questionCount: number) {
    const confirmed = window.confirm(
      `Delete the bank “${name}”?\n\n` +
        (questionCount > 0
          ? `Its ${questionCount} question${questionCount === 1 ? '' : 's'} go with it, out of every quiz asking them.`
          : 'It is empty.') +
        '\n\nThis cannot be undone.',
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(bankId);
      toast.success('Bank deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the bank');
    }
  }

  return (
    <PageCard
      title="Question banks"
      description="Questions your organization has written, each one about a lesson. A quiz asks them — the same question can be asked by any course teaching its lesson."
      actions={
        canEdit ? (
          <BankDialog
            orgId={orgId}
            trigger={
              <Button size="sm">
                <PlusIcon />
                New bank
              </Button>
            }
          />
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
        </div>
      ) : banks.length === 0 ? (
        <EmptyState
          icon={<HelpCircleIcon className="size-5 text-muted-foreground" />}
          title="No question banks yet"
          description="A bank is where questions live. Make one, then write questions into it, import a spreadsheet, or have a model write a set from a lesson."
          action={
            canEdit ? (
              <BankDialog
                orgId={orgId}
                trigger={
                  <Button>
                    <PlusIcon />
                    New bank
                  </Button>
                }
              />
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3">
          {banks.map((bank) => (
            <li
              key={bank.bankId}
              className="group flex items-start gap-4 rounded-3xl border border-border/60 bg-card px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/o/${orgId}/question-banks/${bank.bankId}`}
                  className="text-base font-semibold tracking-tight transition-colors hover:underline"
                >
                  {bank.name}
                </Link>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {bank.questionCount} question{bank.questionCount === 1 ? '' : 's'} · made{' '}
                  {formatDate(bank.createdAt)}
                </p>
                {bank.description && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {bank.description}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {canEdit && (
                  <>
                    <BankDialog
                      orgId={orgId}
                      bank={bank}
                      trigger={
                        <Button variant="outline" size="sm" className="rounded-full">
                          Edit
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(bank.bankId, bank.name, bank.questionCount)}
                    >
                      Delete
                    </Button>
                  </>
                )}
                <Button size="sm" className="rounded-full" asChild>
                  <Link href={`/o/${orgId}/question-banks/${bank.bankId}`}>Open</Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageCard>
  );
}
