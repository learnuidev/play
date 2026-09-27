'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import {
  HeartIcon,
  LinkIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  Trash2Icon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatDuration } from '@/lib/utils';
import { loopColor } from '@/lib/loop-color';
import { linesInRange, type TranscriptLine } from '@/lib/transcript';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoopNameField } from './loop-name-field';
import {
  useDeleteLoop,
  useLoops,
  useToggleLoopLike,
  useUpdateLoop,
} from '@/modules/loop/loop.queries';
import { LOOP_COLORS, type ContentLoop } from '@/types';

/**
 * A learner's loops on a lesson: named stretches worth hearing again.
 *
 * A loop is made the way every A–B repeat has ever been made — mark where it
 * starts, mark where it ends — because that needs no selection mode, no dragging
 * on a scrubber that is already fussy on a laptop trackpad, and works the same
 * while the video is playing, which is when you actually notice the piece you
 * want to hear again.
 *
 * The colour is derived from the loop's own id rather than stored: a list of
 * loops should be told apart at a glance, and a stable colour per id does that
 * without anyone having to choose one.
 */

/** `0:12` for a position in the video. */
const stamp = (ms: number) => formatDuration(ms / 1000);

/** One loop: what it is called, where it is, and what can be done to it. */
function LoopRow({
  loop,
  index,
  active,
  covered,
  mine,
  onSeek,
  onToggle,
  onRename,
  onMoveRange,
  onDelete,
  onLike,
  onShare,
  busy,
}: {
  loop: ContentLoop;
  index: number;
  active: boolean;
  /** The transcript lines the loop covers, in order. Empty when there is none. */
  covered: TranscriptLine[];
  /** Whether the caller made it: only its maker may change it. */
  mine: boolean;
  /** Takes the video to a line — the way back into the audio from the text. */
  onSeek: (timeMs: number) => void;
  onLike: () => void;
  /** Copies a link that opens this lesson on this passage. */
  onShare: () => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onMoveRange: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const color = loopColor(loop);

  return (
    <li
      className={cn(
        'group/row border-b border-border/50 py-3 pl-2 pr-1 transition-colors last:border-b-0',
        active ? 'bg-background' : 'hover:bg-background',
      )}
    >
      {/* The name and where the loop is, on one line. Everything that is *not*
          the passage is kept up here, so the passage below can have the panel's
          whole width — squeezed beside two timestamps it wraps every other word,
          which is what a paragraph looks like when it has nowhere to go. */}
      <div className="flex items-center gap-3">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />

        <button
          type="button"
          onClick={onToggle}
          aria-label={active ? `Stop looping ${loop.name}` : `Loop ${loop.name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          {active ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
        </button>

        {renaming ? (
          <LoopNameField
            initial={loop.name}
            onCommit={(name) => {
              onRename(name);
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
            className="min-w-0 flex-1 rounded-sm border border-ring/60 bg-transparent px-1 py-0 text-base font-medium outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            title="Rename this loop"
            className="min-w-0 flex-1 truncate text-left text-base font-medium"
          >
            {loop.name}
          </button>
        )}

        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {stamp(loop.startMs)} – {stamp(loop.endMs)}
          <span className="text-muted-foreground/50"> · {stamp(loop.endMs - loop.startMs)}</span>
        </span>

        {/* A loop is a passage somebody thought worth hearing again, so the two
            things to do with one you did not make are the two things worth
            doing: say you liked it, or pass it on. */}
        <button
          type="button"
          onClick={onLike}
          aria-pressed={loop.likedByMe}
          title={loop.likedByMe ? 'Take your like back' : 'Like this loop'}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition-colors hover:bg-accent',
            loop.likedByMe ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/70 hover:text-foreground',
          )}
        >
          <HeartIcon className={cn('size-3.5', loop.likedByMe && 'fill-current')} />
          {loop.likeCount > 0 && loop.likeCount}
        </button>

        <button
          type="button"
          onClick={onShare}
          title="Copy a link to this passage"
          aria-label="Copy a link to this passage"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        >
          <LinkIcon className="size-3.5" />
        </button>

        {!mine ? null : busy ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground/50 opacity-0 transition-colors hover:text-foreground group-hover/row:opacity-100 max-sm:opacity-100"
                aria-label={`Actions for ${loop.name}`}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onToggle}>
                <PlayIcon />
                {active ? 'Stop looping' : 'Loop this'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* The same picker the New loop button opens, pre-loaded with this
                  loop's own boundaries — moving a loop is that gesture with a
                  different ending. */}
              <DropdownMenuItem onClick={onMoveRange}>Move boundaries…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* What the loop actually says — the whole passage, as it reads in the
          transcript, across the panel's full width.

          Each sentence is a way back into the audio: the passage is the reason a
          loop was kept, and reading it is how you find the bit you wanted, so
          the text is not merely a label for the timestamps — it is the control. */}
      {covered.length > 0 && (
        <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
          {covered.map((line, lineIndex) => (
            <Fragment key={line.key}>
              {lineIndex > 0 && ' '}
              {/* A span rather than a button: the passage is a paragraph, and it
                  should go on reading as one. A button brings its own styling
                  and an underline on hover, which turns a page of prose into a
                  row of controls — the words are the way in, not a label for
                  one. Only the cursor and the tooltip say so. */}
              <span
                role="button"
                tabIndex={0}
                onClick={() => onSeek(line.start)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSeek(line.start);
                }}
                title={`Play from ${stamp(line.start)}`}
                className="cursor-pointer"
              >
                {line.text}
              </span>
            </Fragment>
          ))}
        </p>
      )}

      <span className="sr-only">{index + 1}</span>
    </li>
  );
}

export function ContentLoops({
  contentId,
  lines,
  activeLoopId,
  onActivate,
  onDeactivate,
  onStartSelection,
  onMoveRange,
  onSeek,
  onShare,
  viewerId,
  canEdit,
}: {
  contentId: string;
  /** The lesson's transcript, so each loop can show what it covers. */
  lines: TranscriptLine[];
  activeLoopId: string | null;
  onActivate: (loop: ContentLoop) => void;
  onDeactivate: () => void;
  /** Opens the loop bar at the playhead, for a loop that does not exist yet. */
  onStartSelection: () => void;
  /** Opens the loop bar on this loop's boundaries, to move them. */
  onMoveRange: (loop: ContentLoop) => void;
  /** Takes the video to a moment in the transcript. */
  onSeek: (timeMs: number) => void;
  /** Copies a link that opens this lesson on a passage. */
  onShare: (loop: ContentLoop) => void;
  /** The caller's own Cognito `sub`, to tell their loops from everyone else's. */
  viewerId?: string;
  canEdit: boolean;
}) {
  const { data, isLoading } = useLoops(contentId);
  const update = useUpdateLoop(contentId);
  const remove = useDeleteLoop(contentId);
  const like = useToggleLoopLike(contentId);

  /** The loop just made, waiting to be named. */
  const [namingId, setNamingId] = useState<string | null>(null);

  const loops = data?.loops ?? [];

  function rename(loop: ContentLoop, name: string) {
    update.mutate(
      { loopId: loop.loopId, name },
      { onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not rename the loop') },
    );
  }

  function destroy(loop: ContentLoop) {
    remove.mutate(loop.loopId, {
      onSuccess: () => {
        if (activeLoopId === loop.loopId) onDeactivate();
        toast.success('Loop deleted');
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not delete the loop'),
    });
  }

  if (isLoading) {
    return <p className="min-h-32 px-6 py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 gap-1.5 px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={onStartSelection}
          disabled={!canEdit}
        >
          <RepeatIcon />
          New loop
        </Button>

        {loops.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground/70">
            {loops.length} loop{loops.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {loops.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm leading-relaxed text-muted-foreground">
          No loops yet. Start one where a piece begins, let it play to where it ends, and keep
          it under a name — it will play round and round until you stop it, and everyone in the
          course can see it.
        </p>
      ) : (
        <ul className="grid">
          {loops.map((loop, index) =>
            namingId === loop.loopId ? (
              <li key={loop.loopId} className="flex items-center gap-3 rounded-lg bg-background py-2 pl-2 pr-1">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: loopColor(loop) }}
                />
                <LoopNameField
                  initial={loop.name}
                  // The same weight as the name it becomes, so a loop does not
                  // change as it is kept: an input carries none of its own.
                  className="font-medium"
                  onCommit={(name) => {
                    rename(loop, name);
                    setNamingId(null);
                  }}
                  onCancel={() => setNamingId(null)}
                />
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {stamp(loop.startMs)} – {stamp(loop.endMs)}
                </span>
              </li>
            ) : (
              <LoopRow
                key={loop.loopId}
                loop={loop}
                index={index}
                active={activeLoopId === loop.loopId}
                covered={linesInRange(lines, loop.startMs, loop.endMs)}
                mine={!viewerId || loop.createdBy === viewerId}
                onSeek={onSeek}
                onLike={() =>
                  like.mutate(
                    { loopId: loop.loopId, liked: loop.likedByMe },
                    {
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : 'Could not save your like'),
                    },
                  )
                }
                onShare={() => onShare(loop)}
                busy={remove.isPending && remove.variables === loop.loopId}
                onToggle={() => (activeLoopId === loop.loopId ? onDeactivate() : onActivate(loop))}
                onRename={(name) => rename(loop, name)}
                onMoveRange={() => onMoveRange(loop)}
                onDelete={() => destroy(loop)}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
