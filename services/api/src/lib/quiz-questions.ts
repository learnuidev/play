import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Content, QuizQuestion, QuizQuestionLink } from '../types';
import { env } from './config';
import { batchGetItems, documentClient as client } from './dynamodb';
import { HttpError } from './http';
import { QUESTIONS_TABLE } from './questions';

export const QUIZ_QUESTIONS_TABLE = env.quizQuestionsTableName;

/**
 * The quizzes that ask one question.
 *
 * A question is shared, so "who else is asking this" is a question the table has
 * to be able to answer: deleting a question has to take it out of every quiz
 * that asks it, and a bank that can only be read one way would leave a quiz
 * pointing at a question that no longer exists.
 */
const QUESTION_INDEX = 'QuestionIndex';

export interface NewQuizQuestionLink {
  contentId: string;
  questionId: string;
  position: number;
  addedBy: string;
}

export async function putQuizQuestionLink(link: QuizQuestionLink): Promise<void> {
  await client.send(new PutCommand({ TableName: QUIZ_QUESTIONS_TABLE, Item: link }));
}

export async function getQuizQuestionLink(
  contentId: string,
  questionId: string,
): Promise<QuizQuestionLink | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: QUIZ_QUESTIONS_TABLE, Key: { contentId, questionId } }),
  );
  return res.Item as QuizQuestionLink | undefined;
}

export async function deleteQuizQuestionLink(contentId: string, questionId: string): Promise<void> {
  await client.send(
    new DeleteCommand({ TableName: QUIZ_QUESTIONS_TABLE, Key: { contentId, questionId } }),
  );
}

/** What one quiz asks, in the order it asks it. */
export async function listQuizQuestionLinks(contentId: string): Promise<QuizQuestionLink[]> {
  const links: QuizQuestionLink[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: QUIZ_QUESTIONS_TABLE,
        KeyConditionExpression: '#contentId = :contentId',
        ExpressionAttributeNames: { '#contentId': 'contentId' },
        ExpressionAttributeValues: { ':contentId': contentId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    links.push(...((res.Items ?? []) as QuizQuestionLink[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return links.sort((a, b) => a.position - b.position || a.questionId.localeCompare(b.questionId));
}

/** The quizzes that ask one question — by id, which is all a cascade needs. */
export async function listQuizzesAsking(questionId: string): Promise<string[]> {
  const contentIds: string[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: QUIZ_QUESTIONS_TABLE,
        IndexName: QUESTION_INDEX,
        KeyConditionExpression: '#questionId = :questionId',
        ExpressionAttributeNames: { '#questionId': 'questionId' },
        ExpressionAttributeValues: { ':questionId': questionId },
        ProjectionExpression: 'contentId',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    contentIds.push(...((res.Items ?? []) as { contentId: string }[]).map((item) => item.contentId));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return [...new Set(contentIds)];
}

/**
 * A quiz's questions, in the order it asks them.
 *
 * Two reads: the quiz's own list of what it asks, then one batch for the
 * questions themselves. A question whose row has gone — deleted from its bank
 * while a link to it survived a half-finished cascade — is skipped rather than
 * crashing the page, because a quiz that asks nine of its ten questions is worth
 * showing and a 500 is not.
 */
export async function listQuestionsForQuiz(contentId: string): Promise<QuizQuestion[]> {
  const links = await listQuizQuestionLinks(contentId);
  if (links.length === 0) return [];

  const questions = await batchGetItems<QuizQuestion>(
    QUESTIONS_TABLE,
    links.map((link) => ({ questionId: link.questionId })),
  );

  const byId = new Map(questions.map((question) => [question.questionId, question]));
  return links.map((link) => byId.get(link.questionId)).filter((question): question is QuizQuestion => Boolean(question));
}

/** One past the last position in a quiz — where an added question lands. */
export async function nextQuizQuestionPosition(contentId: string): Promise<number> {
  const links = await listQuizQuestionLinks(contentId);
  return (links.at(-1)?.position ?? 0) + 1;
}

/**
 * Adds questions to a quiz, at the end.
 *
 * Idempotent per question: one that is already asked is left where it is rather
 * than moved or duplicated, because a picker that adds the same question twice
 * is a person who is not sure whether the first click worked — and answering
 * that with an error would be answering it wrongly. What was already there is
 * reported back, so the page can say so.
 */
export async function addQuestionsToQuiz(
  quiz: Content,
  questions: QuizQuestion[],
  userId: string,
): Promise<{ added: number; alreadyAsked: number }> {
  let position = await nextQuizQuestionPosition(quiz.contentId);
  let added = 0;
  let alreadyAsked = 0;

  for (const question of questions) {
    const existing = await getQuizQuestionLink(quiz.contentId, question.questionId);
    if (existing) {
      alreadyAsked += 1;
      continue;
    }

    // The same rule the picker applies, enforced where it counts: a quiz asks
    // questions about its own course's lessons, and a question about somebody
    // else's lesson would be a question its learners cannot answer.
    if (question.lessonSpaceId !== quiz.spaceId) {
      throw new HttpError(400, 'A quiz can only ask questions about its own course’s lessons');
    }
    if (question.organizationId !== quiz.organizationId) {
      throw new HttpError(400, 'That question belongs to another organization');
    }

    await putQuizQuestionLink({
      contentId: quiz.contentId,
      questionId: question.questionId,
      position,
      addedBy: userId,
      addedAt: Date.now(),
    });

    position += 1;
    added += 1;
  }

  return { added, alreadyAsked };
}

/** Writes positions 1..n over a quiz's links, touching only what moved. */
async function renumberLinks(links: QuizQuestionLink[]): Promise<void> {
  for (const [index, link] of links.entries()) {
    const position = index + 1;
    if (link.position === position) continue;

    await putQuizQuestionLink({ ...link, position });
  }
}

/**
 * Takes a question out of a quiz.
 *
 * The question itself is untouched: it belongs to a bank, and a quiz removing it
 * is a quiz changing its mind, not an author deleting work. The gap closes, so
 * a quiz does not accumulate holes as it is edited.
 */
export async function removeQuestionFromQuiz(contentId: string, questionId: string): Promise<void> {
  await deleteQuizQuestionLink(contentId, questionId);

  const remaining = (await listQuizQuestionLinks(contentId)).filter(
    (link) => link.questionId !== questionId,
  );
  await renumberLinks(remaining);
}

/**
 * Moves a question to a place in the quiz that asks it.
 *
 * The new order is computed here rather than accepted from the client, because
 * the client cannot know it: it sees the list it drew, and between drawing it
 * and dropping on it somebody else may have added a question. `index` is a
 * *place*, and the server is the only party that knows what is currently at each
 * one.
 */
export async function placeQuizQuestion(
  contentId: string,
  questionId: string,
  index: number,
): Promise<QuizQuestionLink[]> {
  const links = await listQuizQuestionLinks(contentId);
  const moved = links.find((link) => link.questionId === questionId);
  if (!moved) throw new HttpError(404, 'That question is not asked by this quiz');

  const without = links.filter((link) => link.questionId !== questionId);
  const at = Math.max(0, Math.min(Math.trunc(index), without.length));
  without.splice(at, 0, moved);

  await renumberLinks(without);
  return without;
}

/**
 * Every link to one question, gone.
 *
 * Called when a question is deleted, and when the lesson it is about is: in both
 * cases the question stops existing, and a quiz left pointing at one would be a
 * quiz with a hole in it that nothing can fill.
 */
export async function deleteLinksForQuestion(questionId: string): Promise<number> {
  const contentIds = await listQuizzesAsking(questionId);
  for (const contentId of contentIds) {
    await deleteQuizQuestionLink(contentId, questionId);
  }
  return contentIds.length;
}

/**
 * Every link on one quiz, gone — which is what deleting a quiz does.
 *
 * The questions are deliberately left alone: they live in banks, they may be
 * asked by other quizzes, and a quiz being deleted is not a reason for the
 * questions it happened to ask to disappear.
 */
export async function deleteLinksForQuiz(contentId: string): Promise<void> {
  const links = await listQuizQuestionLinks(contentId);
  for (const link of links) {
    await deleteQuizQuestionLink(contentId, link.questionId);
  }
}
