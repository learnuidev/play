'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArrowDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  MANUAL_SCROLL_GRACE_MS,
  glideVelocity,
  isJump,
  isSettled,
} from '@/lib/glide';
import {
  applySweepFrame,
  createSweepRuntime,
  getSweepProgress,
  type SweepTarget,
} from '@/lib/sweep';
import { findActiveLine, groupIntoParagraphs, type TranscriptLine } from '@/lib/transcript';

/**
 * The transcript as a page rather than a caption track.
 *
 * Lines are collected into paragraphs the way a speaker's pauses fall, and each
 * paragraph is ordinary flowing text. What animates is the ink: a word is pale
 * until it is said, fills from left to right *through its own letters* as it is
 * spoken, and stays dark once it has been — so the transcript reads as one
 * continuously written page rather than a caption being swapped under the video.
 *
 * What has been said then recedes (`.tt-past` in `globals.css`): the lines above
 * the playhead soften and blur, which leaves exactly one line in focus — the one
 * being said — and lets the page read as a page being *read* rather than one
 * being written over and over. Nothing is lost by it: the words are still there,
 * and a scroll back up or a seek restores them sharp the moment the playhead is
 * over them again. A paragraph the playhead has left recedes in one piece,
 * because there the same picture costs a filtered surface per word.
 *
 * Only what is being said is expensive, and that is the point: the fill is a
 * clipped shader over a glyph run, so it is written onto the one line being said
 * (`tt-live`) and every other word on the sheet is plain ink. The panel is
 * several hundred words tall, and an ordinary scroll repaints what is visible —
 * which is why the resting state is not allowed to cost anything.
 *
 * Three things never go through React, because all three would cost more than
 * the illusion is worth:
 *
 * - **The clock.** The media element only reports its position about four times
 *   a second, which is enough to know where playback is and far too little to
 *   animate against: a fill driven by it steps a quarter of a second at a time.
 *   The loops read `getTime` every frame instead, so the front glides.
 * - **The fill.** A frame loop writes two custom properties onto the words of
 *   the one line being said — how much of each word is filled, and the swell of
 *   the word being said right now.
 * - **The scroll.** The sheet drives its own `scrollTop` towards the line being
 *   read on a spring, so the page drifts to the next line instead of stepping
 *   to it.
 */

/**
 * Where the line being read is parked, in pixels from the top of the sheet.
 *
 * Far enough down that the line before it is still on screen — reading along
 * means seeing where a sentence came from as well as where it is going — and no
 * further, so what is below is what you are reading towards.
 *
 * Pixels rather than a fraction, and spacers rather than padding, because
 * vertical *padding* percentages resolve against an element's width: a "15%" top
 * spacer on a wide page is 15% of the page, not of the stage, which is how a
 * transcript ends up starting halfway down nothing.
 */
const ANCHOR_PX = 56;

/**
 * Room kept above and below, so the first and last line can both reach the
 * anchor. Both are derived from it, so the three cannot drift apart.
 */
const topSpacer = { height: ANCHOR_PX };
// The stage's own height less the anchor: any less and the last line could not
// be scrolled up to where every other line is read.
const bottomSpacer = { height: `calc(100% - ${ANCHOR_PX}px)` };

/** Reading `scrollTop` forces a style flush, so it is trusted for a few frames. */
const RESYNC_FRAMES = 12;

/** One line of a paragraph, and the only kind that runs a fill loop. */
const TranscriptSentence = memo(function TranscriptSentence({
  line,
  index,
  isActive,
  softened,
  selected,
  selectionColor,
  getTime,
  onSeek,
  onSelect,
  registerRef,
}: {
  line: TranscriptLine;
  /** Position in the flat transcript, for seeking back to it. */
  index: number;
  isActive: boolean;
  /**
   * Behind the playhead, and softened on its own.
   *
   * Not simply "behind the playhead": a line inside a paragraph the playhead
   * has left is softened by that paragraph in one piece, and blurring it a
   * second time, word by word, would cost the surfaces the paragraph rule
   * exists to save.
   */
  softened: boolean;
  /** Inside the passage the loop picker is choosing. */
  selected: boolean;
  /** The colour that passage is drawn in. */
  selectionColor?: string;
  /** Playback position in milliseconds, read fresh every frame. */
  getTime: () => number;
  onSeek: (timeMs: number) => void;
  /** Grows the passage around this line, when the picker is open. */
  onSelect?: (line: TranscriptLine) => void;
  registerRef: (index: number, el: HTMLSpanElement | null) => void;
}) {
  const tokenRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // The fill, for the line being said and no other. One word at a time is not
  // enough to see: this is what makes each word darken through its own letters
  // as the playhead crosses it.
  useEffect(() => {
    if (!isActive) return;

    const slots: { start: number; end: number; el: HTMLSpanElement }[] = [];

    line.tokens.forEach((token, tokenIndex) => {
      const el = tokenRefs.current[tokenIndex];
      // Whitespace carries no glyph, so it is neither animated nor counted —
      // which keeps the frame arithmetic indexed by animatable word.
      if (!el || token.isSpace) return;
      slots.push({ start: token.start, end: token.end, el });
    });

    if (slots.length === 0) return;

    const targets: SweepTarget[] = slots.map((slot) => ({ el: slot.el, progress: 0 }));
    const runtime = createSweepRuntime(slots.length);

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const time = getTime();

      for (let i = 0; i < slots.length; i += 1) {
        targets[i].progress = getSweepProgress(time, slots[i].start, slots[i].end);
      }

      applySweepFrame(targets, runtime);
    };

    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);

      // A line that has stopped being said keeps no fill of its own. The loop
      // writes `--p` and `--pop` straight onto the words, and those writes
      // outlive the line being said: without this, the next frame that makes it
      // live again — a seek back to something already heard — would paint it
      // with whatever the last animation left on it, at full ink for one frame
      // before the loop reset it. Removed rather than set to zero, so the words
      // fall back to the plain ink the resting state declares.
      for (const slot of slots) {
        slot.el.style.removeProperty('--p');
        slot.el.style.removeProperty('--pop');
      }
    };
  }, [isActive, line.tokens, getTime]);

  return (
    <span
      ref={(el) => registerRef(index, el)}
      // A whole sentence at a time while choosing a passage, so the band the
      // reader is drawing is the same shape as the text they are drawing it on.
      style={selected ? { backgroundColor: `${selectionColor}24`, borderRadius: '4px' } : undefined}
      // The fill lives behind this class, so it is on the one line being said
      // and nowhere else on the sheet.
      className={cn('cursor-pointer', isActive && 'tt-live')}
      onClick={(event) => {
        // Picking a passage is not watching: a tap that is choosing where a loop
        // ends should not also send the video somewhere.
        if (onSelect) {
          onSelect(line);
          return;
        }

        const start = (event.target as HTMLElement)?.dataset?.tStart;
        const parsed = start === undefined ? NaN : Number(start);
        onSeek(Number.isFinite(parsed) ? parsed : line.start);
      }}
    >
      {line.tokens.map((token, tokenIndex) =>
        token.isSpace ? (
          <span key={token.key} className="whitespace-pre">
            {token.text}
          </span>
        ) : (
          <span
            key={token.key}
            ref={(el) => {
              tokenRefs.current[tokenIndex] = el;
            }}
            data-t-start={token.start}
            // On the tokens rather than on the sentence: they are the
            // inline-blocks a filter can be relied on to paint, and a line on
            // screen is a couple of dozen of them. Only a line of the paragraph
            // the playhead is *in* softens this way — the rest of the sheet is
            // behind the reader, where the paragraph blurs in one piece.
            className={cn('tt-token whitespace-pre', softened && 'tt-past')}
          >
            {token.text}
          </span>
        ),
      )}{' '}
    </span>
  );
});

export function AnimatedTranscript({
  lines,
  getTime,
  onSeek,
  selection,
  selectionColor,
  onSelectLine,
  className,
}: {
  lines: TranscriptLine[];
  /** Playback position in milliseconds, read fresh every frame. */
  getTime: () => number;
  onSeek: (timeMs: number) => void;
  /** The passage a loop is being chosen over, while the picker is open. */
  selection?: { startMs: number; endMs: number } | null;
  selectionColor?: string;
  /** Set while choosing: a tap on a line grows the passage instead of seeking. */
  onSelectLine?: (line: TranscriptLine) => void;
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const sentenceRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const activeRef = useRef(-1);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [following, setFollowing] = useState(true);

  /** Where the line being read wants the sheet to be. */
  const desiredRef = useRef<number | null>(null);
  /** Where the sheet believes it is, without reading `scrollTop` every frame. */
  const virtualRef = useRef<number | null>(null);
  const resyncInRef = useRef(0);
  const positionedRef = useRef(false);
  const manualUntilRef = useRef(0);
  const followingRef = useRef(true);
  const stageHeightRef = useRef(0);
  /** The line we measured last commit, for absorbing shifts above it. */
  const measuredRef = useRef<{ el: HTMLElement; top: number } | null>(null);

  const paragraphs = useMemo(() => groupIntoParagraphs(lines), [lines]);

  const registerRef = useCallback((index: number, el: HTMLSpanElement | null) => {
    sentenceRefs.current[index] = el;
  }, []);

  // The stage's height drives the jump threshold and nothing else, so it lives
  // in a ref: a resize should not re-render a page of prose.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    stageHeightRef.current = stage.clientHeight;
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      stageHeightRef.current = stage.clientHeight;
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Who is being read. This runs every frame but only ever sets state when the
  // line actually changes, so a transcript that is playing costs no renders.
  useEffect(() => {
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const index = findActiveLine(lines, getTime());
      if (index === activeRef.current) return;
      activeRef.current = index;
      setActiveIndex(index);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lines, getTime]);

  // Where the sheet wants to be, measured before the browser paints. Before the
  // first line starts there is nothing being read yet, and the first line waits
  // at the anchor instead — so the page opens exactly where it will be read, and
  // nothing moves when playback reaches it.
  const targetIndex = activeIndex >= 0 ? activeIndex : lines.length > 0 ? 0 : -1;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || targetIndex < 0) return;

    const target = sentenceRefs.current[targetIndex];
    if (!target) return;

    const top = target.offsetTop;
    const measured = measuredRef.current;

    // Absorb anything that moved above the line we are following — a late font,
    // a reflow, text arriving — before it is painted, so the line under the
    // reader's eye never drifts.
    if (measured && measured.el === target && top !== measured.top) {
      stage.scrollTop += top - measured.top;
      virtualRef.current = null;
    }

    measuredRef.current = { el: target, top };
    desiredRef.current = Math.max(0, top - ANCHOR_PX);

    // The first positioning lands on the line instead of gliding to it from the
    // top of the sheet.
    if (!positionedRef.current) {
      positionedRef.current = true;
      stage.scrollTop = desiredRef.current;
      virtualRef.current = desiredRef.current;
    }
  });

  // The glide.
  useEffect(() => {
    let frame = 0;
    let velocity = 0;
    let last = performance.now();

    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);

      const stage = stageRef.current;
      const dt = Math.min(Math.max((now - last) / 1000, 0.001), 0.05);
      last = now;

      if (!stage) return;

      // While the reader is scrolling by hand the sheet is theirs; the loop
      // only keeps its bookkeeping honest so following resumes from there.
      if (now < manualUntilRef.current) {
        if (followingRef.current) {
          followingRef.current = false;
          setFollowing(false);
        }

        velocity = 0;
        virtualRef.current = null;
        return;
      }

      if (!followingRef.current) {
        followingRef.current = true;
        setFollowing(true);
      }

      const desired = desiredRef.current;
      if (desired === null) return;

      if (virtualRef.current === null || resyncInRef.current <= 0) {
        virtualRef.current = stage.scrollTop;
        resyncInRef.current = RESYNC_FRAMES;
      }
      resyncInRef.current -= 1;

      const error = desired - virtualRef.current;

      if (isSettled(error, velocity)) {
        velocity = 0;
        virtualRef.current = desired;
        return;
      }

      // A jump is not a fast glide: a seek, or the playhead arriving from far
      // down the transcript, should land rather than fly through everything
      // between.
      if (reduceMotion || isJump(error, stageHeightRef.current)) {
        velocity = 0;
        virtualRef.current = desired;
        stage.scrollTop = desired;
        return;
      }

      velocity = glideVelocity(error, velocity, dt);
      virtualRef.current += velocity * dt;
      stage.scrollTop = virtualRef.current;
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Taking the sheet in hand pauses following; it picks itself up again once
  // the reader has stopped, and the button below is the impatient way back.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const hold = () => {
      manualUntilRef.current = performance.now() + MANUAL_SCROLL_GRACE_MS;
    };

    stage.addEventListener('wheel', hold, { passive: true });
    stage.addEventListener('touchstart', hold, { passive: true });
    stage.addEventListener('touchmove', hold, { passive: true });
    stage.addEventListener('pointerdown', hold);
    return () => {
      stage.removeEventListener('wheel', hold);
      stage.removeEventListener('touchstart', hold);
      stage.removeEventListener('touchmove', hold);
      stage.removeEventListener('pointerdown', hold);
    };
  }, []);

  const resumeFollowing = useCallback(() => {
    manualUntilRef.current = 0;
  }, []);

  return (
    <div className={cn('relative', className)}>
      <div
        ref={stageRef}
        // `relative` so a sentence's offsetTop is measured inside the sheet that
        // scrolls it, whatever the page around it is doing.
        className="tt-scroll tt-stage relative h-full overflow-y-auto"
      >
        {/* Room for the first and the last line to reach the anchor, so
            following stays exact to the very last word instead of running out
            of scroll. */}
        <div aria-hidden style={topSpacer} />

        {paragraphs.map((paragraph) => {
          // Every line of it is behind the playhead, so the paragraph softens
          // in one piece instead of a blurred surface per word.
          const leftBehind =
            activeIndex >= 0 &&
            paragraph.indices[paragraph.indices.length - 1] < activeIndex;

          return (
            <p
              key={paragraph.key}
              className={cn('tt-para mx-auto max-w-3xl', leftBehind && 'tt-para-past')}
            >
              {paragraph.indices.map((index) => (
                <TranscriptSentence
                  key={lines[index].key}
                  line={lines[index]}
                  index={index}
                  isActive={index === activeIndex}
                  softened={activeIndex >= 0 && index < activeIndex && !leftBehind}
                  selected={Boolean(selection && lines[index].end > selection.startMs && lines[index].start < selection.endMs)}
                  selectionColor={selectionColor}
                  getTime={getTime}
                  onSeek={onSeek}
                  onSelect={onSelectLine}
                  registerRef={registerRef}
                />
              ))}
            </p>
          );
        })}

        <div aria-hidden style={bottomSpacer} />
      </div>

      {/* The fade at the bottom of the sheet: a cover rather than a mask, so
          that nothing inside the scroller is painted any more than once. It sits
          over the sheet and under the button below, and takes no pointer events
          so that scrolling and tapping still reach the words it covers. */}
      <div
        aria-hidden
        className="tt-fade pointer-events-none absolute inset-x-0 bottom-0 h-[10%]"
      />

      {/* Offered, not taken: the sheet has stopped following, and this is the
          way to ask it to start again. */}
      {!following && activeIndex >= 0 && (
        <button
          type="button"
          onClick={resumeFollowing}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <ArrowDownIcon className="size-3.5" />
          Back to the current line
        </button>
      )}
    </div>
  );
}
