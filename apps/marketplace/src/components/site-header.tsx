'use client';

import Link from 'next/link';
import { GraduationCapIcon, SignpostIcon } from 'lucide-react';
import { useIsSignedIn } from '@play/auth';
import { Button } from '@ui/components/ui/button';
import { ThemeToggle } from '@ui/components/theme-toggle';
import { AccountMenu } from '@/components/account-menu';

/**
 * The marketplace's top bar: where you are, and who you are.
 *
 * Shorter than the studio's, because there is less to be: the marketplace has
 * two places — the catalog and the courses you are taking — and a bar full of
 * chrome over a front page is chrome nobody asked for.
 */
export function SiteHeader() {
  const signedIn = useIsSignedIn();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <GraduationCapIcon className="size-4" />
          </span>
          Play
          <span className="text-muted-foreground">Marketplace</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 sm:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Courses</Link>
          </Button>
          {signedIn && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/my-courses">My learning</Link>
            </Button>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          {signedIn ? (
            <AccountMenu />
          ) : (
            <Button asChild size="sm">
              <Link href="/sign-in">
                <SignpostIcon />
                Sign in
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
