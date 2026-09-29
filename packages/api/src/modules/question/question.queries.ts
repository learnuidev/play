import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@api/lib/api';
import { contentKeys } from '@api/modules/content/content.queries';
import { sectionKeys } from '@api/modules/section/section.queries';
import type { QuizGeneration } from '@play/types';

export const questionKeys = {
  all: ['questions'] as const,
  list: (contentId: string) => ['questions', contentId] as const,
};

/** How often a quiz with a run in flight is asked whether it has finished. */
const GENERATION_POLL_MS = 3000;

/**
 * How long a run may look like it is still going before the page stops believing
 * it.
 *
 * The same window the server uses, and it is repeated here on purpose: the
 * server's copy decides whether a *new* run may be started, and this one decides
 * whether to keep polling. A page that believed a dead run forever would poll a
 * quiz that will never change, on a tab somebody left open overnight.
 */
const GENERATION_STALE_MS = 15 * 60 * 1000;

/** Whether a run recorded on a quiz is one worth still waiting for. */
export function isGenerationActive(
  generation: QuizGeneration | undefined,
  now = Date.now(),
): boolean {
  if (!generation) return false;
  if (generation.status !== 'QUEUED' && generation.status !== 'RUNNING') return false;
  return now - (generation.startedAt ?? generation.requestedAt) < GENERATION_STALE_MS;
}

/**
 * A quiz's questions, each with how many are still waiting to be read.
 *
 * Fetched only while something is looking at them, and refetched on the same
 * cache key the mutation hooks invalidate — so a verification elsewhere on the
 * page cannot leave this list showing a question as unread.
 */
export function useQuestions(contentId: string, enabled = true) {
  return useQuery({
    queryKey: questionKeys.list(contentId),
    queryFn: () => api.listQuestions(contentId),
    enabled: Boolean(contentId) && enabled,
  });
}

/**
 * The quiz's content row, polled while a generation is running.
 *
 * The run's state lives on the content — which is also what the page needs for
 * its title and its type — so this is the ordinary content read with one thing
 * added: while the run is in flight it asks again, and it stops as soon as the
 * run reaches an answer. A generation is the only thing in this screen that
 * happens without the reader doing anything, so it is the only thing worth
 * polling for.
 */
export function useQuizContent(contentId: string) {
  return useQuery({
    queryKey: contentKeys.detail(contentId),
    queryFn: () => api.getContent(contentId),
    enabled: Boolean(contentId),
    refetchInterval: (query) => (isGenerationActive(query.state.data?.content.generation) ? GENERATION_POLL_MS : false),
  });
}

/**
 * Refetches the questions when a run finishes.
 *
 * The poll above notices the run is over; this is what turns that into the
 * questions being on the page. Without it the list would sit empty until the
 * reader reloaded — the run wrote its questions to a different endpoint than the
 * one the page is watching.
 *
 * What it waits for is the *transition*: a page opened on a quiz whose last run
 * finished yesterday is not news, and refetching for it would be a second read
 * of the same rows on every visit.
 */
export function useQuestionsAfterGeneration(contentId: string, generation: QuizGeneration | undefined) {
  const qc = useQueryClient();
  const waiting = useRef(false);

  const active = isGenerationActive(generation);

  useEffect(() => {
    if (active) {
      waiting.current = true;
      return;
    }

    if (!waiting.current) return;
    waiting.current = false;
    qc.invalidateQueries({ queryKey: questionKeys.list(contentId) });
  }, [active, contentId, qc]);
}

/** Everything a question change touches: the list, and the content beside it. */
function useQuestionInvalidation(contentId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: questionKeys.list(contentId) });
    qc.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
  };
}

export function useCreateQuestion(contentId: string) {
  const invalidate = useQuestionInvalidation(contentId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.createQuestion>[1]) =>
      api.createQuestion(contentId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateQuestion(contentId: string) {
  const invalidate = useQuestionInvalidation(contentId);
  return useMutation({
    mutationFn: ({ questionId, patch }: { questionId: string; patch: Parameters<typeof api.updateQuestion>[1] }) =>
      api.updateQuestion(questionId, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteQuestion(contentId: string) {
  const invalidate = useQuestionInvalidation(contentId);
  return useMutation({
    mutationFn: (questionId: string) => api.deleteQuestion(questionId),
    onSuccess: invalidate,
  });
}

/**
 * Verifying one question, or taking that back.
 *
 * The answer comes back as the question itself, so the row can be written
 * straight into the list rather than waiting for a refetch — a reviewer working
 * down fifty questions should not watch each one blink.
 */
export function useVerifyQuestion(contentId: string) {
  const qc = useQueryClient();
  const invalidate = useQuestionInvalidation(contentId);

  return useMutation({
    mutationFn: ({ questionId, verified }: { questionId: string; verified: boolean }) =>
      verified ? api.verifyQuestion(questionId) : api.unverifyQuestion(questionId),
    onSuccess: ({ question }, { questionId }) => {
      qc.setQueryData(questionKeys.list(contentId), (previous: Awaited<ReturnType<typeof api.listQuestions>> | undefined) =>
        previous
          ? {
              ...previous,
              questions: previous.questions.map((entry) => (entry.questionId === questionId ? question : entry)),
              needsVerification: previous.questions.filter((entry) =>
                entry.questionId === questionId ? question.status === 'NEEDS_VERIFICATION' : entry.status === 'NEEDS_VERIFICATION',
              ).length,
            }
          : previous,
      );
      invalidate();
    },
  });
}

export function useVerifyQuestions(contentId: string) {
  const invalidate = useQuestionInvalidation(contentId);
  return useMutation({
    mutationFn: (questionIds?: string[]) => api.verifyQuestions(contentId, questionIds),
    onSuccess: invalidate,
  });
}

export function usePlaceQuestion(contentId: string) {
  const invalidate = useQuestionInvalidation(contentId);
  return useMutation({
    mutationFn: ({ questionId, index }: { questionId: string; index: number }) =>
      api.placeQuestion(questionId, index),
    onSuccess: invalidate,
  });
}

export function useImportQuestions(contentId: string) {
  const invalidate = useQuestionInvalidation(contentId);
  return useMutation({
    mutationFn: (payload: Parameters<typeof api.importQuestions>[1]) =>
      api.importQuestions(contentId, payload),
    onSuccess: invalidate,
  });
}

/**
 * Asking for questions to be written.
 *
 * The quiz is named per call rather than bound to the hook, because one of the
 * two callers does not have one yet: the lesson that starts a quiz creates the
 * quiz and asks for its first questions in the same breath, and a hook bound to
 * a quiz id that does not exist until halfway through cannot do that.
 *
 * The response is the quiz with a queued run on it, which is written into the
 * content cache so the page starts polling the moment the request returns rather
 * than after its next read of the same row.
 */
export function useGenerateQuestions(spaceId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contentId, ...payload }: { contentId: string } & Parameters<typeof api.generateQuestions>[1]) =>
      api.generateQuestions(contentId, payload),
    onSuccess: ({ content }) => {
      qc.setQueryData(contentKeys.detail(content.contentId), (previous: { content: unknown; viewer: unknown } | undefined) =>
        previous ? { ...previous, content } : previous,
      );
      if (spaceId) qc.invalidateQueries({ queryKey: sectionKeys.outline(spaceId) });
    },
  });
}
