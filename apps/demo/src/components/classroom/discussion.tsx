'use client';

import { useState } from 'react';
import { Loader2Icon, MessageSquareIcon, ReplyIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { Textarea } from '@ui/components/ui/textarea';
import { cn } from '@ui/lib/utils';
import { commentOnLesson, getLessonComments } from '@/lib/api/v1';
import { useAsync } from '@/lib/use-async';
import type { ApiLessonComment, ApiLessonThread } from '@play/types';

/**
 * The discussion on a lesson: what everybody said, and a box to answer it in.
 *
 * The other half of the comment API, and the half that makes posting worth
 * anything: a comment an app can write and never read back is a comment nobody
 * would write. Both halves of this are scopes — reading it is `lessons:read`,
 * which anybody who can read the lesson already holds, and adding to it is
 * `comments:write`.
 *
 * Three things are worth noticing in how it is drawn, because each is the API
 * showing through:
 *
 * - **Threads arrive assembled.** A reply carries the thread's *root* as its
 *   parent however deep the conversation looks, which is the API's invariant —
 *   so this component never nests: it draws `threads[].replies` one level down
 *   and is right about it.
 * - **Replying is one id.** The box sends `parentId` — the comment being
 *   answered — and the API works out where that sits. Answering a reply is the
 *   same call as answering a top-level comment.
 * - **Your own comments are marked by id.** `authorId` is compared with the
 *   credential's own `owner.userId`, from `GET /v1/me`. There is no "is this
 *   mine" flag on a comment: it is a fact the client already has.
 *
 * What it cannot do is edit or delete anything — the API has no such routes, on
 * purpose. A comment posted here is withdrawn in Play, by the person whose name
 * is on it.
 */
export function Discussion({ contentId, viewerId }: { contentId: string; viewerId?: string }) {
  const [nonce, setNonce] = useState(0);
  const comments = useAsync(() => getLessonComments(contentId), [contentId, nonce]);

  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<ApiLessonComment | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setPosting(true);
    setError(null);
    try {
      const answer = await commentOnLesson(
        contentId,
        body,
        replyingTo?.commentId,
      );
      setPosted(answer.comment.commentId);
      setDraft('');
      setReplyingTo(null);
      // The discussion is re-read rather than patched locally: a reply moves the
      // thread's reply count, and the thread it belongs to may be a page of
      // replies this client has never seen.
      setNonce((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That comment did not post.');
    } finally {
      setPosting(false);
    }
  }

  const threads = comments.data?.threads ?? [];

  return (
    <div className="grid gap-5">
      <form onSubmit={submit} className="grid gap-2">
        <label htmlFor="comment-body" className="text-sm font-medium">
          {replyingTo ? `Replying to ${replyingTo.authorName}` : 'Say something about this lesson'}
        </label>
        <Textarea
          id="comment-body"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={replyingTo ? 'Answer them…' : 'What did you take from it?'}
          rows={3}
          maxLength={2000}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={posting || draft.trim().length === 0}>
            {posting ? <Loader2Icon className="animate-spin" /> : <MessageSquareIcon />}
            {replyingTo ? 'Post reply' : 'Post comment'}
          </Button>
          {replyingTo && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setReplyingTo(null)}>
              <XIcon />
              Cancel reply
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            Posted as you, with <span className="font-mono">comments:write</span> — your name goes on
            it, and it appears in Play&rsquo;s own discussion.
          </span>
        </div>
      </form>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="text-xs leading-relaxed text-muted-foreground">{error}</p>
        </div>
      )}

      {comments.loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : comments.error ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {comments.error.message}
          </p>
        </div>
      ) : threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody has said anything about this lesson yet.
        </p>
      ) : (
        <ul className="grid gap-4">
          {threads.map((thread) => (
            <li key={thread.comment.commentId} className="grid gap-3">
              <Comment
                comment={thread.comment}
                viewerId={viewerId}
                highlighted={posted === thread.comment.commentId}
                onReply={() => setReplyingTo(thread.comment)}
              />
              {thread.replies.length > 0 && (
                <ul className="ml-5 grid gap-3 border-l border-border/60 pl-4">
                  {thread.replies.map((reply) => (
                    <li key={reply.commentId}>
                      <Comment
                        comment={reply}
                        viewerId={viewerId}
                        highlighted={posted === reply.commentId}
                        onReply={() => setReplyingTo(reply)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
        {comments.data?.truncated
          ? 'This discussion is longer than one read, so the most recent 500 comments are shown. '
          : ''}
        This app can read the discussion, post to it and reply to anybody — and nothing else: no
        editing, no deleting, no hearts on a comment. Those are the API&rsquo;s own boundaries: a
        comment posted here is withdrawn in Play, by the person whose name is on it.
      </p>
    </div>
  );
}

/** One comment, with who said it and the way to answer it. */
function Comment({
  comment,
  viewerId,
  highlighted,
  onReply,
}: {
  comment: ApiLessonComment;
  viewerId?: string;
  /** Just posted by this app, so it is easy to find in the thread. */
  highlighted: boolean;
  onReply: () => void;
}) {
  const mine = Boolean(viewerId && comment.authorId === viewerId);

  return (
    <article
      className={cn(
        'rounded-2xl border px-4 py-3',
        highlighted ? 'border-ring/60 bg-muted/50' : 'border-border/60',
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{comment.authorName}</span>
        {mine && (
          <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
            You
          </span>
        )}
        <time
          className="text-xs text-muted-foreground"
          dateTime={new Date(comment.createdAt).toISOString()}
        >
          {new Date(comment.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </time>
        {comment.favouriteCount > 0 && (
          <span className="text-xs text-muted-foreground">{comment.favouriteCount} ♥</span>
        )}
      </header>

      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{comment.body}</p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onReply}>
          <ReplyIcon />
          Reply
        </Button>
        {comment.replyCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {comment.replyCount} {comment.replyCount === 1 ? 'reply' : 'replies'}
          </span>
        )}
      </div>
    </article>
  );
}
