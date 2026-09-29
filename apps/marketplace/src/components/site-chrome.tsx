'use client';

import { usePathname } from 'next/navigation';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { lessonRoute } from '@/lib/routes';

/**
 * The marketplace's frame, or the lack of one.
 *
 * A lesson is watched rather than browsed, so it gets the window: no bar, no
 * footer, no reading measure. That is the same decision the studio's shell makes
 * — a bar of navigation over a classroom is a bar competing with the thing
 * somebody came to watch, and the way back to the course is the lesson's own
 * first line.
 *
 * Signed in or not, a reader of this site keeps the bar. What changes on the
 * sign-in route is only where it stands: the shared sign-in screen is a
 * windowful, and a bar left in the flow would take its own slice of the window
 * out of that screen — a page one bar taller than the window, with the card
 * sitting below the middle of a window it is meant to be the middle of. So the
 * bar is lifted out of the flow there and pinned across the top of the screen
 * instead, which is why that route wears the `group`/`data-chrome-overlay` hook
 * its header reads.
 *
 * The footer goes further and is left out of that route entirely, which is a
 * measurement rather than a preference: a screenful of screen plus a footer is a
 * page 65px taller than the window, and 65px of scrollbar under a page that has
 * nothing under it. A reader who is signing in has the bar above them, and the
 * bar is where both links that footer offers live.
 *
 * Every other page is a column in the middle of the screen: the frame supplies
 * the bar and the footer and nothing else, and each page brings its own measure,
 * because a catalog and a course page do not want the same one.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (lessonRoute(pathname)) {
    // The window, and nothing else done to it. A lesson arranges itself down the
    // whole of it — the classroom's own reading layout draws the bar across the
    // top, the card in the middle and the rail beside it — so the frame's job
    // here is to get out of the way rather than to add a margin. The classroom
    // brings its own padding, which is also what stops the two of them
    // disagreeing about how much room the lesson has.
    return <div className="flex h-svh w-full flex-col overflow-hidden">{children}</div>;
  }

  // The sign-in route is the screen and nothing else: the shared screen is a
  // windowful of its own, and anything else the frame adds — a footer's worth —
  // is height the window does not have, which shows up as a scrollbar on a page
  // that is supposed to be one screen with nothing below it.
  if (pathname === '/sign-in') {
    return (
      <div className="group relative flex min-h-svh flex-col" data-chrome-overlay="true">
        <SiteHeader />
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
