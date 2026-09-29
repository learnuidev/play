import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import { requireCallerContentAccess } from '../../lib/access';
import { requireApiCaller } from '../../lib/auth';
import {
  addCommentCounters,
  assembleLessonThreads,
  listComments,
  putComment,
  resolveCommentThread,
  toApiLessonComment,
} from '../../lib/comments';
import { addContentCounters } from '../../lib/contents';
import { handle, jsonBody, ok, pathParam } from '../../lib/http';
import { requireScope } from '../../lib/oauth-scopes';
import { getProfile, nameOf } from '../../lib/profiles';
import { parseCommentBody } from '../../lib/validation';
import type { Comment } from '../../types';

interface CreateCommentBody {
  body?: unknown;
  /**
   * The comment being replied to. Omit for a top-level comment.
   *
   * One id, not two: the API keeps the thread's two-level rule itself, so a
   * client that answers a reply does not have to work out that the stored parent
   * is the thread's root. See `resolveCommentThread`.
   */
  parentId?: unknown;
}

/**
 * What to call somebody this service has no name for.
 *
 * A comment is written by a *person*, and an app has no idea what they are
 * called — so the name is read here, from the profile they wrote, rather than
 * taken from the token. The token carries no name: it was minted from a consent
 * screen, not from a sign-in.
 */
const UNNAMED = 'Play member';

/**
 * A lesson's discussion, and the two things an app may do to it.
 *
 * `GET` reads it; `POST` adds to it. One resource with two methods and one
 * Lambda, because they are one conversation — and because a function is a
 * Lambda, a log group, a permission and a method, which was four resources
 * against a ceiling of 500 when this was one Serverless stack. The ceiling is
 * gone; the reason to keep one function per resource rather than per method is
 * not, since a second function is a second cold start for the same page.
 *
 * ## Reading
 *
 * Anyone who may read the lesson may read its discussion, so the read is behind
 * `lessons:read` and nothing else. Threads are assembled here rather than handed
 * out as rows: the two-level rule — a reply always carries the thread's *root*,
 * however deep the conversation looks — is this service's invariant, and a client
 * left to nest rows itself is a client left to get it wrong. `truncated` says
 * when a discussion is longer than what was read, so a client can say "the most
 * recent 500" rather than showing half a conversation as if it were all of it.
 *
 * The shape is deliberately *not* the one Play's own apps read: that one carries
 * whether the caller has hearted each comment, and a heart is part of somebody's
 * learning record — what `learning:read` is for — not part of a discussion. A
 * route that hands out a conversation should not hand out a person's saving
 * habits with it.
 *
 * ## Writing
 *
 * The one write under `/v1` that puts somebody's **name** on something: a comment
 * appears in the lesson's discussion under the name of the person who authorized
 * the app, exactly as if they had typed it in Play. That is why it has a scope of
 * its own — `comments:write` — and why the consent screen says so in as many
 * words.
 *
 * **Replies are allowed; editing and deleting are not.** `parentId` answers a
 * comment, and the API works out where that sits in the thread. What it will not
 * do is rewrite or retract something already posted under somebody's name:
 * posting is the permission, and changing what somebody said is a larger one.
 * A comment posted through an app is removed in Play, by the person whose name is
 * on it.
 */
async function main(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = await requireApiCaller(event);
  const contentId = pathParam(event, 'contentId');

  if (event.httpMethod === 'POST') {
    requireScope(caller, 'comments:write');

    const content = await requireCallerContentAccess(contentId, caller);
    const body = jsonBody<CreateCommentBody>(event);
    const text = parseCommentBody(body.body);
    const thread = await resolveCommentThread(contentId, { parentId: body.parentId });

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
      ...thread,
      replyCount: 0,
      favouriteCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await putComment(comment);

    // Two counters: the lesson's total, and the thread's replies when this is
    // one. Both are `ADD`, so a busy discussion cannot lose an increment.
    await addContentCounters(contentId, { commentCount: 1 });
    if (comment.parentId) {
      await addCommentCounters(contentId, comment.parentId, { replyCount: 1 });
    }

    return ok({ comment: toApiLessonComment(comment) }, 201);
  }

  requireScope(caller, 'lessons:read');
  await requireCallerContentAccess(contentId, caller);

  const { comments, truncated } = await listComments(contentId);

  return ok({ threads: assembleLessonThreads(comments), truncated });
}

export const handler = handle(main);
