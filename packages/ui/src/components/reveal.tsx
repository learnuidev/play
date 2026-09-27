'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@ui/lib/utils';

/**
 * A block that arrives as it is scrolled to.
 *
 * Both front pages are long, and a long page read top to bottom benefits from
 * the next thing not being fully there until you get to it: each block rises a
 * few pixels and settles. It is a page's whole animation budget — one gesture,
 * repeated — so nothing on a front door moves in a way that competes with the
 * words.
 *
 * It lives here rather than in either app because both of them draw their front
 * page with it, and the two would otherwise drift: the marketplace's version and
 * the studio's would be the same file with two sets of comments. Nothing in it
 * knows anything about the page it is on, which is what makes it a primitive.
 *
 * Three deliberate refusals, each of which is a way this could go wrong:
 *
 * - **Nothing is hidden until the browser can reveal it.** The server renders
 *   every block visible and this only ever hides one after it has mounted, so a
 *   page with no JavaScript, an old browser, or a hydration that never happens
 *   is a page, not a blank space.
 * - **Anything already on screen stays there.** A block above the fold belongs
 *   in the first paint; fading it in afterwards would make the page look like it
 *   was still loading.
 * - **Less motion means no motion.** Somebody who has asked their system for
 *   less gets the finished page, immediately.
 */
export function Reveal({
  children,
  className,
  /** Kept short: this staggers a row of cards, it does not perform. */
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** Whether this block is still waiting to be scrolled to. */
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // On screen already, so it was in the first paint and should not be animated
    // away from it now that the browser is awake.
    if (element.getBoundingClientRect().top < window.innerHeight * 0.85) return;

    setWaiting(true);

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setWaiting(false);
        observer.disconnect();
      },
      // A tenth of the viewport early: the block is settled by the time its top
      // edge is comfortably in view rather than starting to move as you read it.
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-all duration-700 ease-out motion-reduce:transition-none',
        waiting && 'translate-y-4 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
