import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireCallerContentAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import { putComment, toApiComment } from '../../lib/comments';
import { addContentCounters } from '../../lib/contents';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import { requireScope } from '../../lib/oauth-scopes';
import { getProfile, nameOf } from '../../lib/profiles';
import { parseCommentBody } from '../../lib/validation';
import type { Comment } from '../../types';

interface CreateCommentBody {
  body?: unknown;
}

/**
 * What to call somebody this service has no name for.
 *
 * A comment posted through an app is written by a *person*, and the app has no
 * idea what they are called — so the name is read here, from the profile they
 * wrote, rather than taken from the token. The token carries no name: it was
 * minted from a consent screen, not from a sign-in.
 */
const UNNAMED = 'Play member';

/**
 * A comment on a lesson, posted as the person who authorized the app.
 *
 * The first thing under `/v1` that *speaks* for somebody rather than reading for
 * them, and the only write with a name attached to it: the comment appears in the
 * lesson's discussion under the authorizer's name, exactly as if they had typed
 * it in Play. That is why it has a scope of its own — `comments:write` — and why
 * the consent screen says so in as many words.
 *
 * Three things it deliberately does **not** do:
 *
 * - **No replies.** `/v1` posts a top-level comment and nothing else. Threads are
 *   a shape a Play screen draws — `parentId` and `replyToId` walk a two-level
 *   tree — and a client that can only add one half of a conversation is better
 *   off not being able to aim it at somebody else's answer.
 * - **No editing.** A posted comment is not a draft, and a write scope that
 *   starts as "post" must not quietly become "rewrite what you posted".
 * - **No deleting.** Removing a comment stays in Play, where the person reading
 *   the discussion is the one who wrote it. Handing an app the power to post
 *   *and* retract under somebody's name is a larger grant than "let it comment",
 *   and nothing asked for it.
 *
 * Authorization is reading the lesson: anybody who may read a lesson may take
 * part in its discussion, because a discussion is not an editorial act. The
 * scope is what says the app may write at all.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = await requireApiCaller(event);
  requireScope(caller, 'comments:write');

  const contentId = pathParam(event, 'contentId');
  const content = await requireCallerContentAccess(contentId, caller);

  const body = jsonBody<CreateCommentBody>(event);
  const text = parseCommentBody(body.body);

  // One read, on a write that is rare, and it is a read rather than something
  // carried in the token because a name can change between two comments.
  const profile = await getProfile(caller.userId);

  const now = Date.now();
  const comment: Comment = {
    contentId,
    commentId: ulid(),
    organizationId: content.organizationId,
    authorId: caller.userId,
    authorName: nameOf(profile, UNNAMED),
    body: text,
    replyCount: 0,
    favouriteCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await putComment(comment);

  // The lesson's own counter, so the discussion reads as one more comment
  // everywhere it is drawn. `ADD`, so a busy lesson cannot lose an increment.
  await addContentCounters(contentId, { commentCount: 1 });

  return ok({ comment: toApiComment(comment, false) }, 201);
}

export const handler = handle(main);
