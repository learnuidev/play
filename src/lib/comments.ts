import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Comment, CommentThread } from '../types';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { env } from './config';

export const COMMENTS_TABLE = env.commentsTableName;

/**
 * How much of a discussion is read at once.
 *
 * A thread is only meaningful whole — a reply without the comment it answers
 * says nothing — so a content's comments are read in full rather than paged at
 * the top level. The ceiling is what keeps "in full" bounded; past it the
 * response reports that it was cut short.
 */
export const MAX_THREAD_COMMENTS = 500;

const COUNT_FIELDS = ['replyCount', 'favouriteCount'] as const;

export async function putComment(comment: Comment): Promise<void> {
  await client.send(new PutCommand({ TableName: COMMENTS_TABLE, Item: comment }));
}

export async function getComment(contentId: string, commentId: string): Promise<Comment | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: COMMENTS_TABLE, Key: { contentId, commentId } }),
  );
  return res.Item as Comment | undefined;
}

export async function updateCommentBody(contentId: string, commentId: string, body: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: COMMENTS_TABLE,
      Key: { contentId, commentId },
      UpdateExpression: 'SET #body = :body, editedAt = :editedAt, updatedAt = :editedAt',
      ExpressionAttributeNames: { '#body': 'body' },
      ExpressionAttributeValues: { ':body': body, ':editedAt': Date.now() },
    }),
  );
}

/**
 * Empties a comment that has replies and leaves the row in place.
 *
 * Removing it outright would orphan every answer to it, so what is deleted is
 * the words: the row stays as the thread's parent and carries `deletedAt` for
 * the reader to render as such.
 */
export async function tombstoneComment(contentId: string, commentId: string): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: COMMENTS_TABLE,
      Key: { contentId, commentId },
      UpdateExpression: 'SET #body = :empty, deletedAt = :now, updatedAt = :now',
      ExpressionAttributeNames: { '#body': 'body' },
      ExpressionAttributeValues: { ':empty': '', ':now': Date.now() },
    }),
  );
}

export async function deleteCommentItem(contentId: string, commentId: string): Promise<void> {
  await client.send(new DeleteCommand({ TableName: COMMENTS_TABLE, Key: { contentId, commentId } }));
}

export interface CommentCounterDeltas {
  replyCount?: number;
  favouriteCount?: number;
}

/**
 * Moves a comment's counters by the given deltas. `ADD` is atomic and treats a
 * missing attribute as zero, so two learners favouriting at the same moment
 * cannot lose one another's increment.
 *
 * Like a content's counters, the write is conditional on the row existing: an
 * `ADD` a moment after the comment was deleted would otherwise leave a row
 * holding nothing but an id and a count, and the comment is gone either way, so
 * there is no counter left to move.
 */
export async function addCommentCounters(
  contentId: string,
  commentId: string,
  deltas: CommentCounterDeltas,
): Promise<void> {
  const names: Record<string, string> = { '#commentId': 'commentId' };
  const values: Record<string, unknown> = {};
  const parts: string[] = [];

  for (const field of COUNT_FIELDS) {
    const delta = deltas[field];
    if (delta === undefined || delta === 0) continue;
    names[`#${field}`] = field;
    values[`:${field}`] = delta;
    parts.push(`#${field} :${field}`);
  }

  if (parts.length === 0) return;

  try {
    await client.send(
      new UpdateCommand({
        TableName: COMMENTS_TABLE,
        Key: { contentId, commentId },
        UpdateExpression: `ADD ${parts.join(', ')}`,
        ConditionExpression: 'attribute_exists(#commentId)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) return; // the comment is gone; so is its counter
    throw err;
  }
}

/**
 * Every comment on a content, oldest first, with no ceiling.
 *
 * This is what a cascade reads before it empties a discussion: stopping at the
 * page the reader would have stopped at would leave the rest of the comments
 * behind with no content to belong to.
 */
export async function listAllComments(contentId: string): Promise<Comment[]> {
  const comments: Comment[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: '#contentId = :contentId',
        ExpressionAttributeNames: { '#contentId': 'contentId' },
        ExpressionAttributeValues: { ':contentId': contentId },
        ScanIndexForward: true,
        Limit: 100,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    comments.push(...((res.Items ?? []) as Comment[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return comments;
}

/**
 * A content's comments, oldest first, following pagination until it is
 * exhausted or `MAX_THREAD_COMMENTS` is reached.
 *
 * Pages are read newest-first and the result reversed, so what the ceiling cuts
 * off is the oldest discussion rather than the newest replies — a comment
 * posted a minute ago is never the thing that did not make it.
 */
export async function listComments(contentId: string): Promise<{ comments: Comment[]; truncated: boolean }> {
  const newestFirst: Comment[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: COMMENTS_TABLE,
        KeyConditionExpression: '#contentId = :contentId',
        ExpressionAttributeNames: { '#contentId': 'contentId' },
        ExpressionAttributeValues: { ':contentId': contentId },
        ScanIndexForward: false,
        Limit: Math.min(MAX_THREAD_COMMENTS - newestFirst.length, 100),
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    newestFirst.push(...((res.Items ?? []) as Comment[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey && newestFirst.length < MAX_THREAD_COMMENTS);

  return { comments: newestFirst.reverse(), truncated: Boolean(exclusiveStartKey) };
}

/**
 * Groups a content's comments into two-level threads.
 *
 * A reply never nests further: it carries the top-level comment's id as
 * `parentId`, whatever it answers, so one pass over the rows builds the whole
 * discussion. A reply whose parent is missing (a comment hard-deleted before it
 * had answers) is dropped rather than shown orphaned.
 */
export function assembleThreads(comments: Comment[]): CommentThread[] {
  const threads = new Map<string, CommentThread>();

  for (const comment of comments) {
    if (!comment.parentId) {
      threads.set(comment.commentId, { comment, replies: [] });
    }
  }

  for (const comment of comments) {
    if (!comment.parentId) continue;
    threads.get(comment.parentId)?.replies.push(comment);
  }

  return [...threads.values()];
}
