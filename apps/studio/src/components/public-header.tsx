'use client';

import Link from 'next/link';
import { GraduationCapIcon } from 'lucide-react';
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
 *
 * This is the *front page's* door, and it is worded like one — a front page makes
 * a claim and then offers the thing it is claiming ("Start creating"). The bar
 * above it says the plain version of the same thing, because a bar is a door
 * rather than a pitch; see `PublicHeader` for that one.
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
 * It is the marketplace's bar, deliberately: the same measure (`max-w-6xl`,
 * centered, so the mark lines up with the column the front page is written in),
 * the same height, the same hairline and blur, and the same control at the end —
 * light/dark then the one thing that differs by who is reading. The link beside
 * the mark is where the two bars part company: the marketplace browses
 * ("Discover"), the studio documents, and the reference belongs next to the mark
 * rather than out at the far end of the bar.
 *
 * The button is on every page this bar is on, the sign-in page included. A
 * member is offered the door; everybody else is offered the sign-in page, which
 * on that page is a link to the bar's own screen — the same thing the
 * marketplace's bar does there, and honest for it: the screen underneath is not
 * a detour, it is where the button was always going. Anything else would make
 * the sign-in page the one public page wearing a different bar, and a page
 * somebody can be sent to by a link is the last one that should look like a
 * dead end.
 */
export function PublicHeader() {
  const status = useAuthStatus();

  const entry =
    status === 'authenticated'
      ? { href: '/home', label: 'Open the studio' }
      : { href: '/sign-in', label: 'Sign in' };

  return (
    <header className="sticky top-0 z-10 shrink-0 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm font-medium tracking-tight transition-opacity hover:opacity-70"
        >
          <GraduationCapIcon className="size-4" />
          Play Studio
        </Link>

        <nav
          aria-label="Play"
          className="hidden items-center gap-5 text-sm text-muted-foreground sm:flex"
        >
          <Link href="/docs" className="transition-colors hover:text-foreground">
            API reference
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* The theme is not about who you are, so it is out here rather than
              behind the door, and it comes before the one control that differs. */}
          <ThemeToggle />
          <Button asChild size="sm" className="h-7 rounded-full px-3 text-xs">
            <Link href={entry.href}>{entry.label}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
