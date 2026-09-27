'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  HeartIcon,
  Loader2Icon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ReplyIcon,
  Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@ui/lib/utils';
import { TIMECODE_PATTERN, parseTimecode, timecodeLabel } from '@learning/lib/timecode';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { Textarea } from '@ui/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/components/ui/dropdown-menu';
import { EmojiPicker } from './emoji-picker';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useToggleCommentFavourite,
  useUpdateComment,
} from '@api/modules/learning/learning.queries';
import type { ApiComment, CommentThread } from '@play/types';

/**
 * The discussion on a lesson.
 *
 * Comments, replies, and a heart on each one. Everything a reader does here is
 * a *reading* act rather than an editorial one — anybody who can open the
 * lesson can take part — which is why this tab has no role check on it, only
 * moderating somebody else's words does.
 *
 * Threads are two levels deep, and drawn that way: the replies belong to the
 * comment they answer and are indented under it, because a discussion of a
 * lesson is a handful of questions each with a few answers, and a tree that can
 * go any depth is the shape that makes such a conversation unreadable.
 */

/** The ceiling the backend enforces, so the box can say so before it is hit. */
const MAX_COMMENT_LENGTH = 2000;

/** How close to the ceiling the counter appears. */
const COUNTER_FROM = MAX_COMMENT_LENGTH - 400;

/**
 * The colour an author's avatar is drawn in, derived from their id.
 *
 * Derived rather than stored for the same reason a loop's colour is: a
 * discussion is a list of names, and a stable colour per person is what lets
 * the eye pick out who is speaking without reading every name again.
 */
const AVATAR_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#14b8a6',
  '#0ea5e9',
];

function avatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 1_000_003;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** The date an older comment reads as. */
function staleDate(timestamp: number): string {
  // In the reader's own zone, unlike a space's start date: a comment was
  // written at an instant, and "yesterday" is a different day either side of
  // midnight depending on where it is read.
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

/** `3h ago`, or the date once it is older than a week. */
function timeAgo(timestamp: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return staleDate(timestamp);
}

/** The full moment, for the tooltip behind the relative one. */
function exactTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

/** Anything that reads as a link, so a pasted one is clickable. */
const LINK_PATTERN = /(https?:\/\/[^\s<>]+)/g;

/**
 * Takes back what the sentence put on the end of a link.
 *
 * A URL pasted into a sentence is followed by its full stop, and a link that
 * swallows the punctuation is a link that does not resolve. Brackets are the
 * same problem the other way round — a wikipedia address is full of them — so
 * only the ones the URL never opened are trimmed.
 */
function trimLink(raw: string): string {
  let url = raw.replace(/[.,;:!?'"]+$/, '');

  const opened = url.match(/\(/g)?.length ?? 0;
  let closed = url.match(/\)/g)?.length ?? 0;
  while (closed > opened && url.endsWith(')')) {
    url = url.slice(0, -1);
    closed -= 1;
  }

  return url;
}

/**
 * A moment somebody named, drawn as the control it is.
 *
 * The `@` is the syntax, not the content, so it is not what is shown: the time
 * reads back in the app's own clock — `1:12` — which is what makes `@00:01:12`
 * and `@1:12` the same place in a discussion. It is set in the paragraph's own
 * type, because a time in a sentence is part of the sentence; the colour is
 * what says it can be tapped, the way it says so on a link.
 */
function MomentChip({
  timeMs,
  onSeek,
}: {
  timeMs: number;
  onSeek: (timeMs: number) => void;
}) {
  const label = timecodeLabel(timeMs);

  return (
    <button
      type="button"
      onClick={() => onSeek(timeMs)}
      title={`Play from ${label}`}
      aria-label={`Play from ${label}`}
      className="cursor-pointer rounded-sm text-blue-600 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-blue-400"
    >
      {label}
    </button>
  );
}

/** What a comment says, with its line breaks kept, its links live, and its moments playable. */
function CommentBody({
  body,
  onSeek,
}: {
  body: string;
  /**
   * Puts the playhead at a moment somebody named. Absent when there is nothing
   * to seek in, and a time in a comment stays the words it was written as.
   */
  onSeek?: (timeMs: number) => void;
}) {
  return (
    <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed">
      {body.split(LINK_PATTERN).map((part, index) => {
        // Links are cut out first, so a moment written inside an address stays
        // part of the address: `https://x.test/@2:00` is a link, not a seek.
        //
        // React escapes text, so the only things built here are an anchor and a
        // chip — and only for the two schemes the link pattern allows, so
        // `javascript:` in a comment stays the plain text it deserves to be.
        if (!/^https?:\/\//.test(part)) {
          // The prose, which is where the moments are. Splitting on a pattern
          // with one group puts the matches at the odd indices and the words
          // around them in between, so the sentence reads on unbroken — and the
          // same shape as the link pass above, one level in.
          return (
            <Fragment key={index}>
              {part.split(TIMECODE_PATTERN).map((piece, at) => {
                if (at % 2 === 0 || !onSeek) return piece;

                // A time no clock has — `@70:00` — was prose all along, and
                // stays the words it was written as.
                const timeMs = parseTimecode(piece);
                if (timeMs === null) return piece;

                return <MomentChip key={at} timeMs={timeMs} onSeek={onSeek} />;
              })}
            </Fragment>
          );
        }

        const url = trimLink(part);

        return (
          <Fragment key={index}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:decoration-foreground"
            >
              {url}
            </a>
            {part.slice(url.length)}
          </Fragment>
        );
      })}
    </p>
  );
}

/**
 * The box a comment is written in — a new one, a reply, or an edit.
 *
 * One component for all three, because they are the same box with a different
 * ending: what changes is what is being written and what the button says.
 *
 * The words are the caller's until they are posted: a failed post leaves them
 * in the box rather than swallowing a paragraph into a toast.
 */
function Composer({
  placeholder,
  submitLabel,
  initialBody = '',
  autoFocus = false,
  compact = false,
  hint,
  pending,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  initialBody?: string;
  autoFocus?: boolean;
  /** A reply's box: one line tall, tighter, and it opens downwards. */
  compact?: boolean;
  /**
   * What this box can do that the words alone do not say — the one thing about
   * a comment nobody can guess from the box, so it is written down rather than
   * left to be discovered.
   */
  hint?: string;
  pending: boolean;
  /** Rejects when the write failed, which keeps the words where they are. */
  onSubmit: (body: string) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initialBody);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Where the caret belongs after the next render — an emoji was inserted. */
  const caret = useRef<number | null>(null);

  // The box grows with the sentence rather than scrolling it out of sight. On
  // the way to a line count rather than a fixed height, because a comment is
  // written in one go and what is above it should stay where it was.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, compact ? 180 : 320)}px`;
  }, [value, compact]);

  useLayoutEffect(() => {
    const element = field.current;
    if (caret.current === null || !element) return;
    element.focus();
    element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  /**
   * Puts an emoji where the caret is.
   *
   * The insertion is computed from the element rather than from React state,
   * because where the caret is only the element knows — and the caret is put
   * back by hand afterwards, since replacing the value moves it to the end and
   * an emoji inserted mid-sentence should not send the typing there.
   */
  function addEmoji(char: string) {
    const element = field.current;
    if (!element) {
      setValue((current) => current + char);
      return;
    }

    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    caret.current = start + char.length;
    setValue(`${element.value.slice(0, start)}${char}${element.value.slice(end)}`);
  }

  const body = value.trim();
  const over = body.length > MAX_COMMENT_LENGTH;

  async function submit() {
    if (!body || over || pending) return;

    try {
      await onSubmit(body);
      setValue('');
    } catch {
      // The caller has already said what went wrong; the words stay put.
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-background transition-colors focus-within:border-ring/60',
        compact && 'rounded-lg',
      )}
    >
      <Textarea
        ref={field}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Enter writes the next line — a comment is prose, and a stray
          // newline should not post half a thought. The shortcut posts it.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={compact ? 1 : 2}
        className={cn(
          'min-h-0 resize-none border-0 bg-transparent px-3 pb-1 pt-2 text-[13px] leading-relaxed shadow-none focus-visible:ring-0',
          compact && 'pt-1.5',
        )}
      />

      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        <EmojiPicker onPick={addEmoji} />

        {hint && !compact && (
          <span className="text-[11px] text-muted-foreground/60 max-sm:hidden">{hint}</span>
        )}

        {!compact && (
          <span className="text-[11px] text-muted-foreground/60 max-sm:hidden">
            ⌘↵ to post
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {body.length >= COUNTER_FROM && (
            <span
              className={cn(
                'text-[11px] tabular-nums',
                over ? 'font-medium text-destructive' : 'text-muted-foreground/70',
              )}
            >
              {body.length}/{MAX_COMMENT_LENGTH}
            </span>
          )}

          {onCancel && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          )}

          <Button size="sm" className="h-7 px-2.5" onClick={() => void submit()} disabled={!body || over || pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Who wrote it, and when. */
function Byline({
  comment,
  now,
  children,
}: {
  comment: ApiComment;
  now: number;
  /** The controls, on the right of the line. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="truncate text-[13px] font-medium">{comment.authorName}</span>

      <span className="shrink-0 text-[11px] text-muted-foreground" title={exactTime(comment.createdAt)}>
        {timeAgo(comment.createdAt, now)}
      </span>

      {comment.editedAt && (
        <span
          className="shrink-0 text-[11px] text-muted-foreground/60"
          title={`Edited ${exactTime(comment.editedAt)}`}
        >
          edited
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">{children}</div>
    </div>
  );
}

/** One comment: who said it, what they said, and what can be done about it. */
function CommentRow({
  comment,
  viewerId,
  canModerate,
  /** The thread's top-level comment, which is what a reply is filed under. */
  root,
  /** The author of the comment this one answers, when it answers a reply. */
  answeredName,
  /** Who is being replied to right now, and where the reply box goes. */
  replyTo,
  onReply,
  onCancelReply,
  editing,
  onEdit,
  onCancelEdit,
  onLike,
  onDelete,
  onSeek,
  onSubmitReply,
  onSubmitEdit,
  replyPending,
  editPending,
  busy,
  now,
}: {
  comment: ApiComment;
  viewerId?: string;
  canModerate: boolean;
  root: ApiComment;
  answeredName?: string;
  replyTo: string | null;
  onReply: (comment: ApiComment, rootId: string) => void;
  onCancelReply: () => void;
  editing: string | null;
  onEdit: (comment: ApiComment | null) => void;
  onCancelEdit: () => void;
  onLike: (comment: ApiComment) => void;
  onDelete: (comment: ApiComment) => void;
  /** Plays from a moment somebody named in the comment. */
  onSeek?: (timeMs: number) => void;
  /** Writes a reply under `rootId`, answering `comment`. */
  onSubmitReply: (comment: ApiComment, rootId: string, body: string) => Promise<unknown>;
  onSubmitEdit: (comment: ApiComment, body: string) => Promise<unknown>;
  /** The reply being posted, and the edit being saved: one write at a time. */
  replyPending: boolean;
  editPending: boolean;
  /** This comment is being deleted. */
  busy: boolean;
  now: number;
}) {
  const mine = Boolean(viewerId) && comment.authorId === viewerId;
  const deleted = Boolean(comment.deletedAt);
  /** A deleted comment takes replies with it: the server refuses to file one. */
  const canReply = !deleted && !root.deletedAt;

  return (
    <div className={cn('group/comment flex gap-2.5 py-3', editing === comment.commentId && 'py-2')}>
      <span
        aria-hidden
        className="mt-0.5 flex size-7 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: avatarColor(comment.authorId) }}
      >
        {comment.authorName.trim()[0]?.toUpperCase() ?? '?'}
      </span>

      <div className="min-w-0 flex-1">
        <Byline comment={comment} now={now}>
          {deleted ? null : (
            <>
              {/* The heart. A favourite is a tap, so it is the one control that
                  is not behind the kebab — and it carries its count, because a
                  like nobody can see is a note to yourself. */}
              <button
                type="button"
                onClick={() => onLike(comment)}
                aria-pressed={comment.favourited}
                aria-label={comment.favourited ? 'Remove your like' : 'Like this comment'}
                title={comment.favourited ? 'Remove your like' : 'Like this comment'}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition-colors hover:bg-accent',
                  comment.favourited
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground/70 hover:text-foreground',
                )}
              >
                <HeartIcon className={cn('size-3.5', comment.favourited && 'fill-current')} />
                {comment.favouriteCount > 0 && comment.favouriteCount}
              </button>

              {canReply && (
                <button
                  type="button"
                  onClick={() =>
                    replyTo === comment.commentId ? onCancelReply() : onReply(comment, root.commentId)
                  }
                  title={`Reply to ${comment.authorName}`}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ReplyIcon className="size-3.5" />
                  <span className="max-sm:hidden">Reply</span>
                </button>
              )}

              {(mine || canModerate || busy) &&
                (busy ? (
                  <Loader2Icon className="mx-1.5 size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Comment actions"
                        className="size-7 rounded-md text-muted-foreground/50 opacity-0 transition-colors hover:text-foreground group-hover/comment:opacity-100 max-sm:opacity-100"
                      >
                        <MoreHorizontalIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {/* Only the author may put different words in their own
                          mouth; an editor may take a comment down, not rewrite
                          it — so the two are not the same menu entry, and the
                          second only appears when the first is absent. */}
                      {mine && (
                        <DropdownMenuItem onClick={() => onEdit(comment)}>
                          <PencilIcon />
                          Edit
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDelete(comment)}
                      >
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
            </>
          )}
        </Byline>

        {deleted ? (
          <p className="mt-0.5 text-[13px] italic text-muted-foreground/60">
            This comment was deleted.
          </p>
        ) : editing === comment.commentId ? (
          <div className="mt-2">
            <Composer
              placeholder="Edit your comment"
              submitLabel="Save"
              initialBody={comment.body}
              autoFocus
              compact
              pending={editPending}
              onSubmit={(body) => onSubmitEdit(comment, body)}
              onCancel={onCancelEdit}
            />
          </div>
        ) : (
          <>
            {answeredName && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                Replying to {answeredName}
              </p>
            )}
            <CommentBody body={comment.body} onSeek={onSeek} />
          </>
        )}

        {replyTo === comment.commentId && (
          <div className="mt-2">
            <Composer
              placeholder={`Reply to ${comment.authorName}…`}
              submitLabel="Reply"
              autoFocus
              compact
              pending={replyPending}
              onSubmit={(body) => onSubmitReply(comment, root.commentId, body)}
              onCancel={onCancelReply}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** A top-level comment with the replies it was given. */
function Thread({
  thread,
  viewerId,
  canModerate,
  replyTo,
  onReply,
  onCancelReply,
  editing,
  onEdit,
  onCancelEdit,
  onLike,
  onDelete,
  onSeek,
  onSubmitReply,
  onSubmitEdit,
  replyPending,
  editPending,
  deleting,
  byId,
  now,
}: {
  thread: CommentThread;
  viewerId?: string;
  canModerate: boolean;
  replyTo: string | null;
  onReply: (comment: ApiComment, rootId: string) => void;
  onCancelReply: () => void;
  editing: string | null;
  onEdit: (comment: ApiComment | null) => void;
  onCancelEdit: () => void;
  onLike: (comment: ApiComment) => void;
  onDelete: (comment: ApiComment) => void;
  onSeek?: (timeMs: number) => void;
  onSubmitReply: (comment: ApiComment, rootId: string, body: string) => Promise<unknown>;
  onSubmitEdit: (comment: ApiComment, body: string) => Promise<unknown>;
  replyPending: boolean;
  editPending: boolean;
  /** The comment being deleted, if one is. */
  deleting: string | null;
  byId: Map<string, ApiComment>;
  now: number;
}) {
  const root = thread.comment;

  /** What every row in this thread is told, whoever it is about. */
  const shared = {
    viewerId,
    canModerate,
    replyTo,
    onReply,
    onCancelReply,
    editing,
    onEdit,
    onCancelEdit,
    onLike,
    onDelete,
    onSeek,
    onSubmitReply,
    onSubmitEdit,
    replyPending,
    editPending,
    now,
  };

  return (
    <li className="border-b border-border/50 last:border-b-0">
      <CommentRow
        {...shared}
        comment={root}
        root={root}
        busy={deleting === root.commentId}
      />

      {thread.replies.length > 0 && (
        <ul className="ml-3.5 border-l border-border/60 pl-3">
          {thread.replies.map((reply) => (
            <li key={reply.commentId} className="border-b border-border/40 last:border-b-0">
              <CommentRow
                {...shared}
                comment={reply}
                root={root}
                // Only said when it is not simply an answer to the comment it
                // sits under — which is exactly what the indentation says.
                answeredName={
                  reply.replyToId && reply.replyToId !== reply.parentId
                    ? byId.get(reply.replyToId)?.authorName
                    : undefined
                }
                busy={deleting === reply.commentId}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ContentComments({
  contentId,
  viewerId,
  canModerate,
  onSeek,
}: {
  contentId: string;
  /** The caller's own Cognito `sub`, to tell their comments from everyone's. */
  viewerId?: string;
  /** An admin or editor may take a comment down; only the author may edit one. */
  canModerate: boolean;
  /**
   * Plays from a moment a comment names with an `@`, the way a tap on a loop
   * plays the passage.
   *
   * Handed in rather than reached for, because the playhead belongs to the
   * lesson around this tab — and left out where there is no video to seek in,
   * which is what keeps a time in a comment from being a control that does
   * nothing.
   */
  onSeek?: (timeMs: number) => void;
}) {
  const { data, isLoading } = useComments(contentId);
  const create = useCreateComment(contentId);
  const update = useUpdateComment(contentId);
  const remove = useDeleteComment(contentId);
  const like = useToggleCommentFavourite(contentId);

  /** The comment being answered, whichever level it is on. */
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const threads = useMemo(() => data?.threads ?? [], [data]);

  /** Every comment in the discussion, to name whoever a reply answers. */
  const byId = useMemo(() => {
    const map = new Map<string, ApiComment>();
    for (const thread of threads) {
      map.set(thread.comment.commentId, thread.comment);
      for (const reply of thread.replies) map.set(reply.commentId, reply);
    }
    return map;
  }, [threads]);

  const total = threads.reduce((sum, thread) => sum + 1 + thread.replies.length, 0);

  // Read once per render rather than per row, so every timestamp on the screen
  // is measured against the same moment.
  const now = Date.now();

  /**
   * The four writes, in one place.
   *
   * Every row needs all of them — a reply is posted from inside a thread, a
   * heart is pressed on a row — so they are defined once here and handed down
   * rather than each row growing its own copy of the same request. What the row
   * still owns is what only it knows: which box is open, and what is in it.
   *
   * Each one rethrows: the composer is the thing that decides what a failed
   * write means, and for a comment that means keeping the words.
   */
  async function postComment(body: string) {
    try {
      await create.mutateAsync({ body });
      toast.success('Comment posted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post your comment');
      throw err;
    }
  }

  async function postReply(comment: ApiComment, rootId: string, body: string) {
    try {
      await create.mutateAsync({
        body,
        // The thread's root, whatever is being answered. That is what keeps a
        // discussion two levels deep — and a lesson's whole discussion one
        // query rather than a tree to walk.
        parentId: rootId,
        replyToId: comment.commentId,
      });
      setReplyTo(null);
      toast.success('Reply posted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post your reply');
      throw err;
    }
  }

  async function saveEdit(comment: ApiComment, body: string) {
    try {
      await update.mutateAsync({ commentId: comment.commentId, body });
      setEditing(null);
      toast.success('Comment updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the comment');
      throw err;
    }
  }

  function toggleLike(comment: ApiComment) {
    like.mutate(
      { commentId: comment.commentId, favourited: comment.favourited },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not save your like'),
      },
    );
  }

  async function destroy(comment: ApiComment) {
    // What happens to the replies is the part worth asking about: a comment
    // with answers is emptied rather than removed, so they stay where they are.
    const confirmed = window.confirm(
      comment.replyCount > 0
        ? 'Delete this comment? The replies to it stay, without it.'
        : 'Delete this comment?',
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(comment.commentId);
      toast.success('Comment deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the comment');
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="grid">
      {/* The box is always there, including on an empty discussion: a lesson
          with no comments is one where the first one is waiting to be written,
          and hiding the box behind a button says the opposite. */}
      <Composer
        placeholder="Add a comment…"
        submitLabel="Comment"
        hint={onSeek ? '@1:12 to point at a moment' : undefined}
        pending={create.isPending}
        onSubmit={postComment}
      />

      {threads.length === 0 ? (
        <p className="grid min-h-32 place-items-center px-6 text-center text-[13px] leading-relaxed text-muted-foreground">
          <span className="inline-flex flex-col items-center gap-2">
            <MessageSquareIcon className="size-4 text-muted-foreground/60" />
            No comments yet — ask a question about this lesson, or say what you
            noticed. Everyone in the course can read it and reply.
          </span>
        </p>
      ) : (
        <>
          <p className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {total} comment{total === 1 ? '' : 's'}
          </p>

          {/* The ceiling cuts the *oldest* part of a discussion, so the note
              belongs at the top of what is shown rather than the bottom. */}
          {data?.truncated && (
            <p className="pb-1 text-[12px] text-muted-foreground">
              Showing the most recent comments — the start of this discussion is
              older than this page reads.
            </p>
          )}

          <ul className="grid">
            {threads.map((thread) => (
              <Thread
                key={thread.comment.commentId}
                thread={thread}
                viewerId={viewerId}
                canModerate={canModerate}
                replyTo={replyTo}
                onReply={(comment) => {
                  setEditing(null);
                  setReplyTo(comment.commentId);
                }}
                onCancelReply={() => setReplyTo(null)}
                editing={editing}
                onEdit={(comment) => {
                  setReplyTo(null);
                  setEditing(comment ? comment.commentId : null);
                }}
                onCancelEdit={() => setEditing(null)}
                onLike={toggleLike}
                onDelete={(comment) => void destroy(comment)}
                onSeek={onSeek}
                onSubmitReply={postReply}
                onSubmitEdit={saveEdit}
                replyPending={create.isPending}
                editPending={update.isPending}
                deleting={remove.isPending ? (remove.variables ?? null) : null}
                byId={byId}
                now={now}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
