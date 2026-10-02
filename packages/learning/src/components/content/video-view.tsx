'use client';

import { cn } from '@ui/lib/utils';
import {
  LessonReaderShell,
  type LessonMaterial,
} from '@learning/components/content/lesson-reader';
import type { LessonPanelTab } from '@learning/hooks/use-lesson-tab';

/**
 * A lesson, as somebody taking it sees it.
 *
 * ## The stage is the page
 *
 * A lesson is a picture somebody came to watch, so **nothing is drawn around
 * it**: no card, no edge, no background of its own. The video is the page, the
 * title sits above it, and the bar, the dock and the rail are the furniture
 * around the outside — which is a decision this file exists to hold, because the
 * reading layout used to put a card here whether the content was a video or a
 * question, and a frame around a video says "here is a box with a video in it"
 * rather than "here is the lesson".
 *
 * ## And it has the width it can use
 *
 * The stage is as wide as the reading area: the only thing that limits it is the
 * height it has to fit in, which is what keeps a video whole rather than
 * letterboxed on a short window. It was capped at 64rem as well, which on a wide
 * screen left the picture in the middle of a card with room to spare on both
 * sides of it.
 *
 * What the *reading area* is, where the dock is and how the rail slides out are
 * `LessonReaderShell`'s; what a lesson puts in the middle of it is here.
 */
export function VideoView({
  title,
  stage,
  pills,
  bar,
  materials,
  activeMaterial,
  onToggleMaterial,
  dockLabel,
  railOpen,
  railTitle,
  onCloseRail,
  rail,
}: {
  /**
   * The lesson's name, under the picture. Absent while the lesson is still
   * loading — and a *node* rather than a string because of exactly that: the
   * loading state puts a skeleton in this slot, at the size and in the place the
   * name will take, so the picture above it does not move when the lesson
   * arrives.
   */
  title?: React.ReactNode;
  /**
   * The picture, and everything that belongs on it: the player, the loop picker
   * under it and the card counting down to what plays next.
   *
   * The caller builds it because the player's insides are the caller's — the
   * position, the captions and the loops are state a view has no business
   * holding.
   */
  stage: React.ReactNode;
  /** The row of pills under the stage: the decisions this screen offers. */
  pills: React.ReactNode;
  /** The bar across the top, already built: see `LessonReaderShell`. */
  bar: React.ReactNode;
  materials: LessonMaterial[];
  activeMaterial: LessonPanelTab | null;
  onToggleMaterial: (value: LessonPanelTab) => void;
  dockLabel: string;
  railOpen: boolean;
  railTitle: string;
  onCloseRail: () => void;
  rail: React.ReactNode;
}) {
  return (
    <LessonReaderShell
      bar={bar}
      materials={materials}
      activeMaterial={activeMaterial}
      onToggleMaterial={onToggleMaterial}
      dockLabel={dockLabel}
      railOpen={railOpen}
      railTitle={railTitle}
      onCloseRail={onCloseRail}
      rail={rail}
    >
      <main className="flex min-h-0 flex-1 flex-col">
        {/*
          No padding on the sides, which is the point of this view: the stage
          reaches the reading area's edges.

          And none at the top either, so that with the rail open the picture
          starts where the rail starts. The rail is a whole column of the screen
          and its own box begins at the row's edge; a stage floating 40px below
          that edge, centred in the space left over, is a picture that reads as
          belonging to nothing. So while the rail is open the stage is pinned to
          the top of the reading area and the two line up; with the rail away
          there is nothing to line up with, and the stage sits in the middle of
          the room it has.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-6 [scrollbar-width:none] [-ms-overflow-style:none] sm:pb-10 [&::-webkit-scrollbar]:hidden">
          {/* `min-h-full` inside the scroller rather than centring the scroller
              itself: a flex container that scrolls clips the top of anything
              taller than it. */}
          <div
            className={cn(
              'flex min-h-full flex-col items-center gap-4',
              railOpen ? 'justify-start' : 'justify-center',
            )}
          >
            {/*
              The picture and its title, in **one box**.

              That box is what makes the two line up: the title is written at the
              left of it and the video fills it, so the name starts exactly where
              the picture starts — whether the picture is the full width of the
              reading area or capped by the height it has and sitting in the
              middle of it. Two boxes that each asked for the same width would
              line up only until one of them was given a different one.
            */}
            <div className={cn('flex w-full flex-col gap-4', STAGE_WIDTH)}>
              {stage}

              {/* Under the picture rather than over it. A lesson *is* the video,
                  so a title above the thing you came to watch is a line of text
                  between the reader and it; underneath, it reads as the caption
                  it is. */}
              {title ? (
                <h1 className="text-left text-lg font-semibold tracking-tight sm:text-xl">
                  {title}
                </h1>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center justify-center gap-2 px-5 pt-4 pb-5">
          {pills}
        </div>
      </main>
    </LessonReaderShell>
  );
}

/**
 * How wide the stage and its title are.
 *
 * **Height first, and no other cap.** A video's shape is fixed at 16:9, so a box
 * sized only by width letterboxes the picture on a short window or pushes the
 * pills off a tall one; sizing it by the height it has, times the shape, keeps
 * the picture whole and the row where it belongs. It used to be
 * `min(64rem, …)`, and the 64 was the card's width — with the card gone there is
 * nothing for that number to line up with, and the reading area is the only
 * width that means anything.
 *
 * One constant rather than a class written out twice, because the box it is on
 * now holds both the picture and the lesson's name: the name is written at that
 * box's left, so the two edges meet only for as long as the two agree about the
 * width.
 */
const STAGE_WIDTH = 'max-w-[calc((100svh_-_19rem)*16_/_9)]';

/**
 * The box a lesson's video is drawn in.
 *
 * The width comes from the box `VideoView` puts around it — the same box the
 * title is in — so this is only what the *picture* needs: to fill it, and to
 * clip nothing when the arithmetic above got the height slightly wrong.
 *
 * A component rather than a class the caller is asked to remember, because a
 * stage built without this is a video with no height to it, and what a stage is
 * should live in the view that draws it.
 */
export function VideoStage({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('relative w-full max-h-full', className)}>{children}</div>;
}
