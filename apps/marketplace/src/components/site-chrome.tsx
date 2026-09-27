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
 * The sign-in page is *not* one of these. Somebody who has not decided to sign in
 * yet is still reading this site, and taking the bar away is how they stop being
 * able to; the shared sign-in screen asks the frame how much room it has left
 * instead, which is what `--sign-in-min-height` is.
 *
 * Every other page is a column in the middle of the screen: the frame supplies
 * the bar and the footer and nothing else, and each page brings its own measure,
 * because a catalog and a course page do not want the same one.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (lessonRoute(pathname)) {
    // Full height rather than full width alone: the classroom splits itself into
    // the video and the panel beside it and expects to be given the window to do
    // it in, with its own scrolling inside.
    return (
      <div className="flex h-svh w-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="h-full w-full px-4 py-4 lg:px-6 lg:py-5">{children}</div>
        </div>
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
