'use client';

import Link from 'next/link';
import { ArrowRightIcon, ClapperboardIcon } from 'lucide-react';
import { useAuthStatus } from '@play/auth';
import { Button } from '@ui/components/ui/button';
import { ThemeToggle } from '@ui/components/theme-toggle';

/**
 * Where the studio's calls to action go, for whoever is looking at them.
 *
 * A member is offered the door they walk through every morning; everybody else is
 * offered the sign-in page, which knows where to send them afterwards. While the
 * session is still being restored the second answer is the one shown: for a
 * member it means one redirect and lands in the same place, whereas showing
 * "Open the studio" to somebody who has no account is simply the wrong button.
 */
export function useStudioEntry() {
  const status = useAuthStatus();

  return status === 'authenticated'
    ? { href: '/home', label: 'Open the studio' }
    : { href: '/sign-in?next=/home', label: 'Start creating' };
}

/**
 * The bar over the studio's public pages.
 *
 * Not the app's header: the pages it sits on are read by people who are not in
 * the app yet — the front page, and the sign-in page — so it carries the mark,
 * the one other thing there is to read (the API reference), and the way in. The
 * studio's *own* pages have their own headers, and they are different bars with
 * different jobs: one is navigation around an account, this is a door.
 *
 * `showEntry` is off on the sign-in page, where the button would point at the
 * page it is already sitting above. Everything else about the bar is the same,
 * because a sign-in screen with no way off it is a dead end, and the reason
 * somebody is on it is usually that they followed a link rather than that they
 * meant to arrive.
 */
export function PublicHeader({ showEntry = true }: { showEntry?: boolean }) {
  const entry = useStudioEntry();

  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border/40 bg-background/70 px-4 backdrop-blur-xl">
      <Link
        href="/"
        className="flex items-center gap-1.5 text-sm font-medium tracking-tight transition-opacity hover:opacity-70"
      >
        <ClapperboardIcon className="size-4" />
        Play Studio
      </Link>

      <nav aria-label="Play" className="ml-4 hidden items-center gap-3 sm:flex">
        <Link
          href="/docs"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          API reference
        </Link>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeToggle />
        {showEntry && (
          <Button asChild size="sm">
            <Link href={entry.href}>
              {entry.label}
              <ArrowRightIcon />
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
