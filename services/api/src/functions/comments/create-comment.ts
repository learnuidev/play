import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireContentAccess } from '../../lib/access';
import { displayNameOf, requireUser } from '../../lib/auth';
import { addCommentCounters, putComment, resolveCommentThread } from '../../lib/comments';
import { addContentCounters } from '../../lib/contents';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
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
  const thread = await resolveCommentThread(contentId, body);

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
