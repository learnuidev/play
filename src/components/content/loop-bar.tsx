'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, PauseIcon, PlayIcon, RepeatIcon, XIcon } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
import {
  snapRangeToLines,
  snapToLineBoundary,
  stepLineBoundary,
  type TranscriptLine,
} from '@/lib/transcript';
import { LoopNameField } from './loop-name-field';

/**
 * The bar that owns a loop while it is being chosen.
 *
 * It sits directly under the video, inside the player's own frame, and says one
 * thing — where the loop is — and offers the two or three things you can still
 * do with it: move either end, hear it, keep it under a name.
 *
 * The boundaries are the point of it, so they are drawn on a track rather than
 * printed as numbers: a band you can see is a band you can drag, and the two
 * handles on it are the whole picker. They nudge with the arrow keys too, so a
 * boundary can be placed exactly without a steady hand.
 *
 * Every colour here comes from the theme rather than from the video above it — a
 * bar that assumed a dark page is a black slab in the light one — with the single
 * exception of the loop's own accent, which is a saturated mid-tone carrying
 * white text and reads on either.
 *
 * The range lives *here* rather than in the page while it is being dragged: a
 * pointer moving across a track fires sixty times a second, and re-rendering a
 * lesson — transcript and all — sixty times a second to move a handle is how a
 * picker ends up feeling heavy. Committing hands it back up.
 */

/**
 * How far a handle moves per arrow key without a transcript to snap to. With
 * one, arrows step from sentence to sentence instead.
 */
const NUDGE_SECONDS = 1;
const NUDGE_SECONDS_COARSE = 5;

/** A new loop opens about this long, since a phrase is about this long. */
export const DEFAULT_LOOP_SECONDS = 10;

/** The most sentence marks a band will draw, however long the passage is. */
const MAX_MARKS = 240;

export interface LoopRange {
  startMs: number;
  endMs: number;
}

const stamp = (ms: number) => formatDuration(Math.max(0, ms) / 1000);

const PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground';

export function LoopBar({
  durationMs,
  getTimeMs,
  seekTo,
  initialRange,
  accentColor,
  /** The lesson's transcript, so the passage can show where speech starts and stops. */
  lines,
  /** How many transcript lines the passage covers, when there is a transcript. */
  selectedLines,
  /** The opening of the passage, so the reader can see what they have chosen. */
  selectedText,
  /** The loop being moved, when the picker was opened on an existing one. */
  editingName,
  previewing,
  onToggleLooping,
  onSave,
  onCancel,
}: {
  durationMs: number;
  getTimeMs: () => number;
  seekTo: (timeMs: number) => void;
  initialRange: LoopRange;
  accentColor: string;
  lines?: TranscriptLine[];
  selectedLines?: number;
  selectedText?: string;
  editingName?: string;
  /** True while the passage is being played round and round. */
  previewing: boolean;
  /** Stops or restarts that, to hear what lies either side of the passage. */
  onToggleLooping: () => void;
  onSave: (range: LoopRange, name: string) => void;
  onCancel: () => void;
}) {
  // Opened already snapped: a loop made before this rule existed, or handed over
  // from somewhere else, is still a passage rather than two timestamps.
  const [range, setRange] = useState<LoopRange>(() =>
    lines?.length
      ? snapRangeToLines(lines, initialRange.startMs, initialRange.endMs)
      : initialRange,
  );
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [naming, setNaming] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLSpanElement>(null);
  const playedRef = useRef<HTMLSpanElement>(null);

  const duration = Math.max(durationMs, 1);
  const ratio = (timeMs: number) => Math.max(0, Math.min(timeMs / duration, 1));

  /**
   * Where the playhead is, drawn every frame without a re-render — the same
   * bargain the transcript makes, for the same reason.
   */
  useEffect(() => {
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);

      const time = getTimeMs();
      const head = playheadRef.current;
      if (head) head.style.transform = `translateX(${ratio(time) * 100}%)`;

      // How far through the loop the playhead has got: the band fills as the
      // phrase is heard, so its progress is visible without a second control.
      const played = playedRef.current;
      if (played) {
        const span = Math.max(range.endMs - range.startMs, 1);
        const through = Math.max(0, Math.min((time - range.startMs) / span, 1));
        played.style.transform = `scaleX(${through})`;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getTimeMs, range.startMs, range.endMs, duration]);

  /** Where a pointer is on the track, as milliseconds into the video. */
  function timeFromEvent(clientX: number): number {
    const track = trackRef.current;
    if (!track) return 0;

    const { left, width } = track.getBoundingClientRect();
    if (width <= 0) return 0;

    return Math.max(0, Math.min(((clientX - left) / width) * duration, duration));
  }

  /**
   * Puts a boundary down, at the sentence nearest the moment asked for.
   *
   * There is no version of this that lands between sentences: the picker is a
   * picker of passages, and a passage is a whole number of them. The ends cannot
   * cross either — a move that would put one past the other is refused and the
   * boundary stays where it was, which is less startling than the two of them
   * swapping places.
   */
  function moveEdge(edge: 'start' | 'end', timeMs: number) {
    setRange((current) => {
      const snapped = lines?.length
        ? snapToLineBoundary(lines, timeMs, edge)
        : Math.max(0, Math.min(Math.round(timeMs), duration));

      if (snapped === undefined) return current;

      const clamped = Math.max(0, Math.min(snapped, duration));

      if (edge === 'start') {
        if (clamped >= current.endMs) return current;
        return { startMs: clamped, endMs: current.endMs };
      }

      if (clamped <= current.startMs) return current;
      return { startMs: current.startMs, endMs: clamped };
    });
  }

  const lengthMs = range.endMs - range.startMs;
  const startRatio = ratio(range.startMs);
  const endRatio = ratio(range.endMs);

  /**
   * Where the sentences inside the passage begin — the words actually spoken,
   * marked on the band.
   *
   * A band that is one solid colour says only how long the passage is; the marks
   * say how it is *spoken*: where a line starts, where the pauses between them
   * fall, and therefore where the talking begins and stops. The passage's own
   * edges are the first and last of them, because a passage is snapped to whole
   * lines.
   *
   * Capped, because a very long passage would draw a mark every few pixels and
   * turn the band into a grey smear — which is the thing the marks are for
   * avoiding. The first and last sentences never fall outside the cap: they are
   * the band's own edges.
   */
  const marks = useMemo(() => {
    if (!lines?.length) return [];

    return lines
      .filter((line) => line.start > range.startMs + 50 && line.start < range.endMs - 50)
      .slice(0, MAX_MARKS)
      .map((line) => ({
        key: line.key,
        ratio: (line.start - range.startMs) / Math.max(lengthMs, 1),
      }));
  }, [lines, range.startMs, range.endMs, lengthMs]);

  return (
    <div
      role="group"
      aria-label={editingName ? `Move ${editingName}` : 'New loop'}
      className="loop-bar relative border-t border-border/60 bg-card px-4 pb-3.5 pt-3 text-card-foreground"
    >
      {/* A hairline of the loop's own colour along the top edge, so the bar and
          the band on its track are obviously the same thing. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: accentColor }}
        >
          <RepeatIcon className="size-3.5" />
          {editingName ? 'Move loop' : 'New loop'}
        </span>

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {stamp(range.startMs)} – {stamp(range.endMs)}
          <span className="text-muted-foreground/60"> · {stamp(lengthMs)}</span>
          {selectedLines !== undefined && selectedLines > 0 && (
            <span className="text-muted-foreground/60">
              {' · '}
              {selectedLines} line{selectedLines === 1 ? '' : 's'}
            </span>
          )}
        </span>

        {selectedText && (
          // What has been chosen, in the reader's own words: the numbers say
          // where it is, this says what it is.
          <span className="hidden min-w-0 flex-1 truncate text-xs italic text-muted-foreground lg:inline">
            “{selectedText}”
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            title="Take the end from where the video has reached"
            onClick={() => {
              // Marking the end where the video has reached is the whole gesture
              // — you press it while listening, not afterwards.
              moveEdge('end', Math.round(getTimeMs()));
              seekTo(range.startMs);
            }}
            className={PILL}
          >
            Set end to here
          </button>

          <button
            type="button"
            title={
              previewing
                ? 'Stop playing just this passage, to hear either side of it'
                : 'Play just this passage, round and round'
            }
            onClick={onToggleLooping}
            className={PILL}
          >
            {previewing ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
            {previewing ? 'Pause loop' : 'Loop range'}
          </button>

          {naming ? (
            <LoopNameField
              initial={editingName ?? ''}
              onCommit={(name) => onSave(range, name)}
              onCancel={() => setNaming(false)}
              // The field wears the loop's colour, so the thing being named and
              // the thing on the track are visibly the same thing.
              style={{ borderColor: accentColor }}
              className="w-44 rounded-full border-2 bg-transparent px-3 py-1 text-[11px] font-medium text-foreground outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: accentColor }}
            >
              <CheckIcon className="size-3" />
              <span className="max-w-[9rem] truncate">
                {editingName ? `Update ${editingName}` : 'Save loop'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel this loop"
            className="ml-0.5 inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      </div>

      {/* The track: everything outside the loop steps back, and the band between
          the handles is what the reader is choosing. */}
      <div className="flex items-center gap-3 pt-2.5">
        <div ref={trackRef} className="relative h-6 flex-1 touch-none select-none">
          <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/10" />

          <span
            className="absolute top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full"
            style={{
              left: `${startRatio * 100}%`,
              width: `${Math.max((endRatio - startRatio) * 100, 0.5)}%`,
              background: accentColor,
              boxShadow: `0 0 14px ${accentColor}70`,
            }}
          >
            {/* How far through the phrase the playhead has got. */}
            <span
              ref={playedRef}
              className="absolute inset-0 origin-left bg-white/35"
              style={{ transform: 'scaleX(0)' }}
            />

            {/* Where each sentence inside the passage starts. */}
            {marks.map((mark) => (
              <span
                key={mark.key}
                aria-hidden
                className="absolute inset-y-0 w-px bg-white/55"
                style={{ left: `${mark.ratio * 100}%` }}
              />
            ))}
          </span>

          {/* The playhead, written by the frame loop above. It is the page's own
              ink rather than a colour, so it is a hairline in both themes. */}
          <span
            ref={playheadRef}
            className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 rounded-full bg-foreground/80"
            style={{ transform: 'translateX(0%)' }}
          />

          {(['start', 'end'] as const).map((edge) => {
            const time = edge === 'start' ? range.startMs : range.endMs;
            const isDragging = dragging === edge;

            return (
              <span
                key={edge}
                role="slider"
                tabIndex={0}
                aria-label={edge === 'start' ? 'Loop start' : 'Loop end'}
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration / 1000)}
                aria-valuenow={Math.round(time / 1000)}
                aria-valuetext={stamp(time)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  setDragging(edge);
                }}
                onPointerMove={(event) => {
                  if (!isDragging) return;
                  moveEdge(edge, timeFromEvent(event.clientX));
                }}
                onPointerUp={(event) => {
                  if (!isDragging) return;
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                  setDragging(null);
                }}
                onPointerCancel={() => setDragging(null)}
                onKeyDown={(event) => {
                  const direction =
                    event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                  if (direction === 0) return;

                  // With a transcript, an arrow moves the boundary to the
                  // neighbouring sentence — a second's nudge would land
                  // mid-sentence, which is the thing this refuses to do.
                  const stepped = lines?.length
                    ? stepLineBoundary(lines, time, edge, direction)
                    : time +
                      direction * (event.shiftKey ? NUDGE_SECONDS_COARSE : NUDGE_SECONDS) * 1000;

                  if (stepped !== undefined) moveEdge(edge, stepped);
                  event.preventDefault();
                }}
                className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: `${ratio(time) * 100}%` }}
              >
                {/* A white dot ringed in the loop's colour: it reads on a light
                    rail and a dark one alike, which is what the handle has to
                    do in a bar that follows the theme. */}
                <span
                  className="block rounded-full bg-white transition-transform duration-150 ease-out"
                  style={{
                    width: isDragging ? 16 : 14,
                    height: isDragging ? 16 : 14,
                    transform: isDragging ? 'scale(1.1)' : undefined,
                    boxShadow: `0 0 0 2px ${accentColor}, 0 2px 8px rgba(0,0,0,0.35)`,
                  }}
                />
                {/* A generous hit area around a small dot. */}
                <span className="absolute -inset-x-2.5 -inset-y-3" />

                {isDragging && (
                  <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-0.5 text-[11px] font-medium tabular-nums text-popover-foreground shadow-lg ring-1 ring-border">
                    <span style={{ color: accentColor }} className="mr-1">
                      {edge === 'start' ? 'Start' : 'End'}
                    </span>
                    {stamp(time)}
                  </span>
                )}
              </span>
            );
          })}
        </div>

        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {stamp(duration)}
        </span>
      </div>
    </div>
  );
}
