import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ApiComment, ApiLessonComment, Comment, CommentThread } from '../types';
import { documentClient as client, isConditionalCheckFailed } from './dynamodb';
import { env } from './config';
import { HttpError } from './http';

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
 * The storage row as the API's shape.
 *
 * A comment is keyed by its content and itself, and both are already part of
 * what a comment *is* — what this adds is the caller's own favourite, which the
 * stored row must not carry because it is a different learner's answer.
 */
export function toApiComment(comment: Comment, favourited: boolean): ApiComment {
  return { ...comment, favourited };
}

/**
 * Groups a content's comments into two-level threads.
 *
 * A reply never nests further: it carries the top-level comment's id as
 * `parentId`, whatever it answers, so one pass over the rows builds the whole
 * discussion. A reply whose parent is missing (a comment hard-deleted before it
 * had answers) is dropped rather than shown orphaned.
 */
export function assembleThreads(comments: ApiComment[]): CommentThread[] {
  return assemble<ApiComment>(comments, (comment) => comment as ApiComment);
}

/**
 * The same grouping, for whatever shape a route hands its comments out in.
 *
 * Generic over the *output* and not over the input, because the rows are always
 * comments — `ApiComment` is a `Comment` with a flag on it. What changes between
 * routes is the shape they are handed out in, and the rule being applied is the
 * one that matters: a reply carries the **thread's root** as its `parentId`,
 * however deep the conversation looks, so one pass over the rows builds the whole
 * discussion. A second copy of that loop in a second route is a second place for
 * it to be got wrong.
 */
function assemble<T>(comments: Comment[], toWire: (comment: Comment) => T): CommentThreadGeneric<T>[] {
  const threads = new Map<string, CommentThreadGeneric<T>>();

  for (const comment of comments) {
    if (!comment.parentId) threads.set(comment.commentId, { comment: toWire(comment), replies: [] });
  }

  for (const comment of comments) {
    if (!comment.parentId) continue;
    threads.get(comment.parentId)?.replies.push(toWire(comment));
  }

  return [...threads.values()];
}

/** One top-level comment and its replies, in whatever shape a route hands out. */
export interface CommentThreadGeneric<T> {
  comment: T;
  replies: T[];
}

/**
 * A comment as `/v1` hands it out.
 *
 * Deliberately *not* `ApiComment`: that shape carries whether the **caller** has
 * hearted the comment, which is part of somebody's learning record — the thing
 * `learning:read` is for — and not part of the discussion. A route that hands out
 * a discussion should not quietly hand out a person's hearts with it, and a field
 * that always says `false` would be worse than absent.
 */
export function toApiLessonComment(comment: Comment): ApiLessonComment {
  return {
    commentId: comment.commentId,
    contentId: comment.contentId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    body: comment.body,
    ...(comment.parentId ? { parentId: comment.parentId } : {}),
    ...(comment.replyToId ? { replyToId: comment.replyToId } : {}),
    replyCount: comment.replyCount,
    favouriteCount: comment.favouriteCount,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

/** The `/v1` shape of a discussion: threads, and whether it was cut short. */
export function assembleLessonThreads(comments: Comment[]): CommentThreadGeneric<ApiLessonComment>[] {
  return assemble(comments, toApiLessonComment);
}

/**
 * Where a new comment sits in its thread.
 *
 * Threads are two levels: a reply to a reply keeps the same top-level parent and
 * records who it answers separately. So whatever was answered, what is stored as
 * `parentId` is the thread's root — which is what makes a content's whole
 * discussion one query instead of a tree to walk.
 *
 * Exported because two routes create comments — Play's own, under a session, and
 * `/v1`, under a scope — and the invariant above is exactly the kind of thing
 * that must not have a second implementation.
 */
export async function resolveCommentThread(
  contentId: string,
  requests: { parentId?: unknown; replyToId?: unknown },
): Promise<{ parentId?: string; replyToId?: string }> {
  const requested =
    typeof requests.parentId === 'string' && requests.parentId ? requests.parentId : undefined;
  if (!requested) return {};

  const parent = await getComment(contentId, requested);
  if (!parent) throw new HttpError(404, 'The comment being replied to was not found');
  if (parent.deletedAt) throw new HttpError(409, 'That comment has been deleted');

  const rootId = parent.parentId ?? parent.commentId;

  const answeredId =
    typeof requests.replyToId === 'string' && requests.replyToId ? requests.replyToId : requested;
  if (answeredId !== requested) {
    const answered = await getComment(contentId, answeredId);
    if (!answered) throw new HttpError(404, 'The comment being answered was not found');
    if (answered.deletedAt) throw new HttpError(409, 'That comment has been deleted');
    if ((answered.parentId ?? answered.commentId) !== rootId) {
      throw new HttpError(400, 'A reply must answer a comment in the same thread');
    }
  }

  return { parentId: rootId, replyToId: answeredId };
}
