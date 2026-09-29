import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import type { QuizGeneration } from '@play/types';

/**
 * The banks, the questions in them, and what a quiz asks of them.
 *
 * Two ideas decide the cache keys here:
 *
 * - **A question belongs to a bank**, so everything that changes one invalidates
 *   that bank's list — and the bank row, because its counter and its last
 *   generation are on it.
 * - **A quiz only references questions**, so adding, removing or reordering one
 *   in a quiz touches the quiz's own list and nothing about the question. That
 *   is why `quizQuestionKeys` is separate from `bankKeys.questions`.
 */

export const bankKeys = {
  all: ['question-banks'] as const,
  list: (orgId: string) => ['question-banks', orgId] as const,
  detail: (bankId: string) => ['question-bank', bankId] as const,
  questions: (bankId: string) => ['question-bank', bankId, 'questions'] as const,
};

export const quizQuestionKeys = {
  all: ['quiz-questions'] as const,
  list: (contentId: string) => ['quiz-questions', contentId] as const,
};

/** How often a bank with a run in flight is asked whether it has finished. */
const GENERATION_POLL_MS = 3000;

/**
 * How long a run may look like it is still going before the page stops believing
 * it.
 *
 * The same window the server uses, and it is repeated here on purpose: the
 * server's copy decides whether a *new* run may be started, and this one decides
 * whether to keep polling. A page that believed a dead run forever would poll a
 * bank that will never change, on a tab somebody left open overnight.
 */
const GENERATION_STALE_MS = 15 * 60 * 1000;

/** Whether a run recorded on a bank is one worth still waiting for. */
export function isGenerationActive(
  generation: QuizGeneration | undefined,
  now = Date.now(),
): boolean {
  if (!generation) return false;
  if (generation.status !== 'QUEUED' && generation.status !== 'RUNNING') return false;
  return now - (generation.startedAt ?? generation.requestedAt) < GENERATION_STALE_MS;
}

/* -------------------------------------------------------------------------
 * Banks
 * ---------------------------------------------------------------------- */

/** The banks an organization owns. Any member may read them. */
export function useQuestionBanks(orgId: string) {
  return useQuery({
    queryKey: bankKeys.list(orgId),
    queryFn: () => api.listQuestionBanks(orgId),
    enabled: Boolean(orgId),
  });
}

export function useCreateQuestionBank(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createQuestionBank>[1]) =>
      api.createQuestionBank(orgId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: bankKeys.list(orgId) }),
  });
}

/**
 * One bank, on its own — polled while a generation is running against it.
 *
 * The run's state rides on the row this reads, which is why the page needs no
 * second request to know whether something is happening.
 */
export function useQuestionBank(bankId: string) {
  return useQuery({
    queryKey: bankKeys.detail(bankId),
    queryFn: () => api.getQuestionBank(bankId),
    enabled: Boolean(bankId),
    refetchInterval: (query) =>
      isGenerationActive(query.state.data?.bank.generation) ? GENERATION_POLL_MS : false,
  });
}

export function useUpdateQuestionBank(bankId: string, orgId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateQuestionBank>[1]) =>
      api.updateQuestionBank(bankId, patch),
    onSuccess: ({ bank }) => {
      qc.setQueryData(bankKeys.detail(bankId), { bank });
      if (orgId) qc.invalidateQueries({ queryKey: bankKeys.list(orgId) });
    },
  });
}

/** Deleting a bank takes its questions with it, out of every quiz asking them. */
export function useDeleteQuestionBank(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bankId: string) => api.deleteQuestionBank(bankId),
    onSuccess: () => qc.invalidateQueries({ queryKey: bankKeys.list(orgId) }),
  });
}

/* -------------------------------------------------------------------------
 * The questions in a bank
 * ---------------------------------------------------------------------- */

/**
 * A bank's questions, with the bank itself and how many need reading.
 *
 * One request draws the whole page: the bank's name, how much is in it, and its
 * questions in the order it holds them. The page groups them by lesson, because
 * a bank is a list somebody works down.
 */
export function useBankQuestions(bankId: string) {
  return useQuery({
    queryKey: bankKeys.questions(bankId),
    queryFn: () => api.listBankQuestions(bankId),
    enabled: Boolean(bankId),
  });
}

/**
 * Refetches a bank's questions when its run finishes.
 *
 * What it waits for is the *transition*: a page opened on a bank whose last run
 * finished yesterday is not news, and refetching for it would be a second read
 * of the same rows on every visit. The seen-it-running flag is a module-level
 * set keyed by bank, so it survives renders and does not leak from one bank's
 * page to another's.
 */
const runningSeen = new Set<string>();

export function useQuestionsAfterGeneration(bankId: string, generation: QuizGeneration | undefined) {
  const qc = useQueryClient();
  const active = isGenerationActive(generation);

  useEffect(() => {
    if (active) {
      runningSeen.add(bankId);
      return;
    }

    if (!runningSeen.delete(bankId)) return;

    void qc.invalidateQueries({ queryKey: bankKeys.questions(bankId) });
    void qc.invalidateQueries({ queryKey: bankKeys.detail(bankId) });
  }, [active, bankId, qc]);
}

/** Everything a change to a question touches: the bank's list and the bank row. */
function useQuestionInvalidation(bankId?: string) {
  const qc = useQueryClient();
  return () => {
    if (bankId) {
      qc.invalidateQueries({ queryKey: bankKeys.questions(bankId) });
      qc.invalidateQueries({ queryKey: bankKeys.detail(bankId) });
    }
  };
}

export function useCreateQuestion(bankId: string) {
  const invalidate = useQuestionInvalidation(bankId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createQuestion>[1]) =>
      api.createQuestion(bankId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateQuestion(bankId?: string) {
  const invalidate = useQuestionInvalidation(bankId);
  return useMutation({
    mutationFn: ({ questionId, patch }: { questionId: string; patch: Parameters<typeof api.updateQuestion>[1] }) =>
      api.updateQuestion(questionId, patch),
    onSuccess: invalidate,
  });
}

/**
 * Deleting a question from its bank.
 *
 * It comes out of every quiz asking it, and the answer says how many — which is
 * what a page puts in the confirmation before somebody does it.
 */
export function useDeleteQuestion(bankId?: string) {
  const invalidate = useQuestionInvalidation(bankId);
  return useMutation({
    mutationFn: (questionId: string) => api.deleteQuestion(questionId),
    onSuccess: invalidate,
  });
}

/**
 * Verifying one question, or taking that back.
 *
 * The answer comes back as the question itself, so a row can be written straight
 * into the list rather than waiting for a refetch — a reviewer working down fifty
 * questions should not watch each one blink.
 */
export function useVerifyQuestion(bankId?: string) {
  const qc = useQueryClient();
  const invalidate = useQuestionInvalidation(bankId);

  return useMutation({
    mutationFn: ({ questionId, verified }: { questionId: string; verified: boolean }) =>
      verified ? api.verifyQuestion(questionId) : api.unverifyQuestion(questionId),
    onSuccess: ({ question }, { questionId }) => {
      if (bankId) {
        qc.setQueryData(
          bankKeys.questions(bankId),
          (previous: Awaited<ReturnType<typeof api.listBankQuestions>> | undefined) =>
            previous
              ? {
                  ...previous,
                  questions: previous.questions.map((entry) =>
                    entry.questionId === questionId ? question : entry,
                  ),
                  needsVerification: previous.questions.filter((entry) =>
                    entry.questionId === questionId
                      ? question.status === 'NEEDS_VERIFICATION'
                      : entry.status === 'NEEDS_VERIFICATION',
                  ).length,
                }
              : previous,
        );
      }
      invalidate();
    },
  });
}

export function useVerifyQuestions(bankId: string) {
  const invalidate = useQuestionInvalidation(bankId);
  return useMutation({
    mutationFn: (questionIds?: string[]) => api.verifyQuestions(bankId, questionIds),
    onSuccess: invalidate,
  });
}

export function useImportQuestions(bankId: string) {
  const invalidate = useQuestionInvalidation(bankId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.importQuestions>[1]) =>
      api.importQuestions(bankId, payload),
    onSuccess: invalidate,
  });
}

/**
 * Asking for questions to be written into a bank.
 *
 * The response is the bank with a queued run on it, which is written into the
 * cache so the page starts polling the moment the request returns rather than
 * after its next read of the same row.
 */
export function useGenerateQuestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bankId,
      ...payload
    }: { bankId: string } & Parameters<typeof api.generateQuestions>[1]) =>
      api.generateQuestions(bankId, payload),
    onSuccess: ({ bank }) => {
      qc.setQueryData(bankKeys.detail(bank.bankId), { bank });
      // A run can be asked to add what it writes to a quiz, so that quiz's list
      // is stale the moment it finishes.
      if (bank.generation?.addToContentId) {
        qc.invalidateQueries({
          queryKey: quizQuestionKeys.list(bank.generation.addToContentId),
        });
      }
    },
  });
}

/** Clearing a finished run's record, once its author has read it. */
export function useDismissGeneration(bankId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.dismissQuestionGeneration(bankId),
    onSuccess: () => qc.invalidateQueries({ queryKey: bankKeys.detail(bankId) }),
  });
}

/* -------------------------------------------------------------------------
 * A course's questions
 * ---------------------------------------------------------------------- */

export const spaceQuestionKeys = {
  all: ['space-questions'] as const,
  list: (spaceId: string) => ['space-questions', spaceId] as const,
};

/**
 * Every question about a course's lessons, from every bank.
 *
 * One read for the whole course — the table is indexed by the lesson's course
 * for exactly this — and the page groups them by lesson, in the course's own
 * order, which the course's outline already knows.
 */
export function useSpaceQuestions(spaceId: string) {
  return useQuery({
    queryKey: spaceQuestionKeys.list(spaceId),
    queryFn: () => api.listSpaceQuestions(spaceId),
    enabled: Boolean(spaceId),
  });
}

/**
 * Verifying one question from a course's page.
 *
 * The same act as verifying it from its bank — one question, one record of who
 * read it — and this exists only because the list it changes is a third one:
 * what a course shows is neither a bank's list nor a quiz's.
 */
export function useVerifySpaceQuestion(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ questionId, verified }: { questionId: string; verified: boolean }) =>
      verified ? api.verifyQuestion(questionId) : api.unverifyQuestion(questionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: spaceQuestionKeys.list(spaceId) }),
  });
}

/* -------------------------------------------------------------------------
 * What a quiz asks
 * ---------------------------------------------------------------------- */

/**
 * What a quiz asks, in the order it asks it.
 *
 * Each question arrives with its bank and the lesson it is about: the quiz holds
 * references, so every row has to say where the question came from.
 */
export function useQuizQuestions(contentId: string, enabled = true) {
  return useQuery({
    queryKey: quizQuestionKeys.list(contentId),
    queryFn: () => api.listQuizQuestions(contentId),
    enabled: Boolean(contentId) && enabled,
  });
}

function useQuizInvalidation(contentId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: quizQuestionKeys.list(contentId) });
}

export function useAddQuizQuestions(contentId: string) {
  const invalidate = useQuizInvalidation(contentId);
  return useMutation({
    mutationFn: (questionIds: string[]) => api.addQuizQuestions(contentId, questionIds),
    onSuccess: invalidate,
  });
}

/** Taking a question out of the quiz — which leaves it in its bank. */
export function useRemoveQuizQuestion(contentId: string) {
  const invalidate = useQuizInvalidation(contentId);
  return useMutation({
    mutationFn: (questionId: string) => api.removeQuizQuestion(contentId, questionId),
    onSuccess: invalidate,
  });
}

export function usePlaceQuizQuestion(contentId: string) {
  const invalidate = useQuizInvalidation(contentId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.placeQuizQuestion>[1]) =>
      api.placeQuizQuestion(contentId, payload),
    onSuccess: invalidate,
  });
}

export function useVerifyQuizQuestions(contentId: string) {
  const invalidate = useQuizInvalidation(contentId);
  return useMutation({
    mutationFn: (questionIds?: string[]) => api.verifyQuizQuestions(contentId, questionIds),
    onSuccess: invalidate,
  });
}
