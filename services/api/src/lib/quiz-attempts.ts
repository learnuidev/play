import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  Content,
  QuizAttempt,
  QuizAttemptAnswer,
  QuizAttemptSummary,
  QuizPaperQuestion,
  QuizQuestion,
} from '../types';
import { env } from './config';
import { documentClient as client } from './dynamodb';

export const QUIZ_ATTEMPTS_TABLE = env.quizAttemptsTableName;

/**
 * How many of a learner's attempts at one quiz are read at once.
 *
 * A ceiling rather than a limit anybody should meet — it is twenty sittings of
 * one quiz — and it is what keeps the page that draws them a single read with a
 * bounded answer. The newest are the ones kept, because the newest are the ones
 * anybody looks at.
 */
export const MAX_ATTEMPTS_READ = 20;

/**
 * A learner's attempts at one quiz, in one partition.
 *
 * The quiz comes first so that everything ever asked of this table is a query
 * against one partition: a learner's own history is a `begins_with` over their
 * id, and everything the quiz ever collected is the partition itself, which is
 * what deleting the quiz reads. Both ids are ULIDs or a Cognito `sub`, neither
 * of which contains a `#`, so the separator is unambiguous.
 */
export function attemptKey(userId: string, attemptId: string): string {
  return `${userId}#${attemptId}`;
}

/** The prefix that is one learner's attempts inside a quiz's partition. */
function learnerPrefix(userId: string): string {
  return `${userId}#`;
}

export async function putQuizAttempt(attempt: QuizAttempt): Promise<void> {
  await client.send(new PutCommand({ TableName: QUIZ_ATTEMPTS_TABLE, Item: attempt }));
}

/**
 * What one learner has scored on one quiz, newest first.
 *
 * The sort key is `userId#attemptId`, so a `begins_with` on the learner's own id
 * is their whole history in this quiz and nothing else's. `attemptId` is a ULID,
 * which sorts by the moment it was made, so reading backwards is newest first
 * without a second attribute to order by.
 */
export async function listQuizAttempts(
  contentId: string,
  userId: string,
  limit = MAX_ATTEMPTS_READ,
): Promise<QuizAttempt[]> {
  const res = await client.send(
    new QueryCommand({
      TableName: QUIZ_ATTEMPTS_TABLE,
      KeyConditionExpression: '#contentId = :contentId AND begins_with(#attemptKey, :prefix)',
      ExpressionAttributeNames: { '#contentId': 'contentId', '#attemptKey': 'attemptKey' },
      ExpressionAttributeValues: { ':contentId': contentId, ':prefix': learnerPrefix(userId) },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  return (res.Items ?? []) as QuizAttempt[];
}

/**
 * Every attempt at one quiz, gone — which is what deleting the quiz does.
 *
 * Unlike a favourite, which is a learner's own pointer and is skipped when its
 * target has gone, an attempt is a record of answering *this* quiz: with the
 * quiz deleted there is nothing it is an attempt at, and nothing reads it —
 * nothing looks up an attempt except through the quiz it was made in. So the
 * cascade takes them, and it can, because they are all in this one partition.
 */
export async function deleteAttemptsForQuiz(contentId: string): Promise<number> {
  let deleted = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: QUIZ_ATTEMPTS_TABLE,
        KeyConditionExpression: '#contentId = :contentId',
        ExpressionAttributeNames: { '#contentId': 'contentId' },
        ExpressionAttributeValues: { ':contentId': contentId },
        ProjectionExpression: '#contentId, attemptKey',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      await client.send(
        new DeleteCommand({
          TableName: QUIZ_ATTEMPTS_TABLE,
          Key: { contentId: contentId, attemptKey: item.attemptKey as string },
        }),
      );
      deleted += 1;
    }

    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return deleted;
}

/**
 * A question as a learner is handed it: the answer key removed.
 *
 * Written as a function rather than done inline at each call site, because
 * "forgetting to strip it" is the failure that matters here and a shape with
 * nowhere to put the key cannot have it.
 */
export function toPaperQuestion(question: QuizQuestion): QuizPaperQuestion {
  return {
    questionId: question.questionId,
    type: question.type,
    prompt: question.prompt,
    options: question.options,
  };
}

/**
 * The half of an attempt that crosses the wire.
 *
 * `userId`, `attemptKey` and `organizationId` are the table's business: the key
 * is how the row is addressed and the learner is the caller, who does not need
 * telling their own id back.
 */
export function toWireAttempt(attempt: QuizAttempt): Omit<QuizAttempt, 'userId' | 'attemptKey' | 'organizationId'> {
  const { userId: _userId, attemptKey: _attemptKey, organizationId: _organizationId, ...wire } = attempt;
  return wire;
}

/** One attempt as anything but the result screen reads it: the numbers, no answers. */
export function toAttemptSummary(attempt: QuizAttempt): QuizAttemptSummary {
  return {
    attemptId: attempt.attemptId,
    questionCount: attempt.questionCount,
    correctCount: attempt.correctCount,
    score: attempt.score,
    submittedAt: attempt.submittedAt,
  };
}

/** One answer as it is recorded: the question's words, and what was done with them. */
export function toAttemptAnswer(
  question: QuizQuestion,
  optionId: string | undefined,
): QuizAttemptAnswer {
  return {
    questionId: question.questionId,
    prompt: question.prompt,
    options: question.options,
    ...(optionId !== undefined ? { optionId } : {}),
    correctOptionIds: question.correctOptionIds,
    correct: optionId !== undefined && question.correctOptionIds.includes(optionId),
    ...(question.explanation ? { explanation: question.explanation } : {}),
  };
}

/** How a set of answers did, in the two numbers an attempt records. */
export function scoreAnswers(answers: QuizAttemptAnswer[]): {
  questionCount: number;
  correctCount: number;
  score: number;
} {
  const questionCount = answers.length;
  const correctCount = answers.filter((answer) => answer.correct).length;
  return {
    questionCount,
    correctCount,
    score: questionCount === 0 ? 0 : Math.round((correctCount / questionCount) * 100),
  };
}

/**
 * The row a submission becomes.
 *
 * The answers are the marking, so this takes them rather than working anything
 * out: what a question's right answer was is decided where the question is read,
 * next to the code that refuses to hand it out.
 */
export function toQuizAttempt(input: {
  attemptId: string;
  userId: string;
  quiz: Content;
  answers: QuizAttemptAnswer[];
  submittedAt: number;
}): QuizAttempt {
  const { questionCount, correctCount, score } = scoreAnswers(input.answers);

  return {
    attemptId: input.attemptId,
    userId: input.userId,
    attemptKey: attemptKey(input.userId, input.attemptId),
    contentId: input.quiz.contentId,
    spaceId: input.quiz.spaceId,
    organizationId: input.quiz.organizationId,
    questionCount,
    correctCount,
    score,
    answers: input.answers,
    submittedAt: input.submittedAt,
  };
}
