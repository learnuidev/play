'use client';

import Link from 'next/link';
import { GraduationCapIcon } from 'lucide-react';
import { useAuthStatus } from '@play/auth';
import { Button } from '@ui/components/ui/button';
import { ThemeToggle } from '@ui/components/theme-toggle';
import { AccountMenu } from '@/components/account-menu';

/**
 * The top bar: a slim, translucent band that lets the page through.
 *
 * Deliberately quiet. Everything under it is the point of the page, so the bar
 * is one line of small text over a blurred backdrop rather than a piece of
 * furniture with borders and buttons in it — and it is the same bar whether
 * somebody is signed in or not, with the one control that differs at the end.
 *
 * Light or dark is the studio's control too, in the same place and the same
 * shape: one product read in two apps, and a reader should not have to find the
 * switch in a different corner on each. It is `@play/ui`'s `ThemeToggle` rather
 * than a marketplace copy for the same reason. (Each app remembers its own
 * answer — they are separate origins, so `next-themes`' storage is not shared —
 * but the thing itself is one control.)
 */
export function SiteHeader() {
  const status = useAuthStatus();

  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/70 backdrop-blur-xl group-data-[chrome-overlay=true]:absolute group-data-[chrome-overlay=true]:inset-x-0 group-data-[chrome-overlay=true]:top-0">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm font-medium tracking-tight transition-opacity hover:opacity-70"
        >
          <GraduationCapIcon className="size-4" />
          Play
          <span className="font-normal text-muted-foreground">Marketplace</span>
        </Link>

        <nav className="ml-auto flex items-center gap-5 text-sm text-muted-foreground">
          <Link href="/discover" className="transition-colors hover:text-foreground">
            Discover
          </Link>
          {status === 'authenticated' && (
            <Link href="/my-courses" className="transition-colors hover:text-foreground">
              My learning
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {/* The theme is not about who you are, so it is out here rather than
              inside the account menu, and it comes before the one control that
              does differ. */}
          <ThemeToggle />
          {/* Nothing while the session is still being restored: a button that
              says "Sign in" to somebody who is signed in is a worse answer than
              no button for a moment. */}
          {status === 'configuring' ? null : status === 'authenticated' ? (
            <AccountMenu />
          ) : (
            <Button asChild size="sm" className="h-7 rounded-full px-3 text-xs">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
