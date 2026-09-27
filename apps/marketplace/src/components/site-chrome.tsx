'use client';

import { usePathname } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { lessonRoute } from '@/lib/routes';

/**
 * The marketplace's frame, or the lack of one.
 *
 * A lesson is watched rather than browsed, so it gets the window: no top bar, no
 * reading measure, no padding to spare. That is the same decision the studio's
 * shell makes — a bar of navigation over a classroom is a bar competing with the
 * thing somebody came to watch, and the way back to the course is the lesson's
 * own first line.
 *
 * Every other page is a column of prose in the middle of a wide screen, which is
 * what `max-w-6xl` is for.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (lessonRoute(pathname)) {
    return (
      // Full height rather than full width alone: the classroom splits itself
      // into the video and the panel beside it and expects to be given the
      // window to do it in, with its own scrolling inside.
      <div className="flex h-svh w-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="h-full w-full px-4 py-4 lg:px-6 lg:py-5">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">{children}</main>
    </>
  );
}
