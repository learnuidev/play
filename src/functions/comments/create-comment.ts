import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireContentAccess } from '../../lib/access';
import { displayNameOf, requireUser } from '../../lib/auth';
import { addCommentCounters, getComment, putComment } from '../../lib/comments';
import { addContentCounters } from '../../lib/contents';
import { HttpError, handle, jsonBody, ok, pathParam } from '../../lib/http';
import { parseCommentBody } from '../../lib/validation';
import type { Comment } from '../../types';

interface CreateCommentBody {
  body?: unknown;
  /** The comment being replied to. Omit for a top-level comment. */
  parentId?: unknown;
  /** The specific comment being answered, when that differs from `parentId`. */
  replyToId?: unknown;
}

/**
 * Works out where a new comment sits in its thread.
 *
 * Threads are two levels: the reply to a reply keeps the same top-level parent
 * and records who it answers separately. So whatever was answered, what is
 * stored as `parentId` is the thread's root — which is what makes a content's
 * whole discussion one query instead of a tree to walk.
 */
async function resolveThread(
  contentId: string,
  body: CreateCommentBody,
): Promise<{ parentId?: string; replyToId?: string }> {
  const requested = typeof body.parentId === 'string' && body.parentId ? body.parentId : undefined;
  if (!requested) return {};

  const parent = await getComment(contentId, requested);
  if (!parent) throw new HttpError(404, 'The comment being replied to was not found');
  if (parent.deletedAt) throw new HttpError(409, 'That comment has been deleted');

  const rootId = parent.parentId ?? parent.commentId;

  const answeredId = typeof body.replyToId === 'string' && body.replyToId ? body.replyToId : requested;
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

/**
 * Comments on a piece of content, or replies to a comment on it.
 *
 * Anyone who can read the content can take part: a discussion is not an
 * editorial act, so this asks for reading access rather than the write access
 * that creating content requires.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = requireUser(event);
  const contentId = pathParam(event, 'contentId');

  const content = await requireContentAccess(contentId, user.userId, 'read');

  const body = jsonBody<CreateCommentBody>(event);
  const text = parseCommentBody(body.body);
  const thread = await resolveThread(contentId, body);

  const now = Date.now();
  const comment: Comment = {
    contentId,
    commentId: ulid(),
    organizationId: content.organizationId,
    authorId: user.userId,
    authorName: displayNameOf(user),
    body: text,
    ...thread,
    replyCount: 0,
    favouriteCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await putComment(comment);

  // Two counters: the content's total, and the thread's replies when this is
  // one. Both are `ADD`, so a busy discussion cannot lose an increment.
  await addContentCounters(contentId, { commentCount: 1 });
  if (comment.parentId) {
    await addCommentCounters(contentId, comment.parentId, { replyCount: 1 });
  }

  return ok({ comment }, 201);
}

export const handler = handle(main);
