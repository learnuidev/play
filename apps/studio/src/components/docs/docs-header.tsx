'use client';

import Link from 'next/link';
import { ClapperboardIcon, KeyRoundIcon, LogInIcon } from 'lucide-react';
import { useAuthStatus } from '@play/auth';
import { ThemeToggle } from '@ui/components/theme-toggle';
import { Button } from '@ui/components/ui/button';

/**
 * The reference's own header.
 *
 * Not the app's: the pages behind the sidebar are the product, and a reference
 * is something else — you arrive at it from a key you just made, read one
 * section, and leave. So it keeps the mark, a way back, and one link on the
 * right.
 *
 * Which link depends on who is reading, and that is new: the page used to be
 * behind the sign-in gate, so "API keys" was always a page the reader could
 * open. Now that anybody can read the reference, the honest answer for somebody
 * without an account is the way to get one — a key screen they would be bounced
 * off is not a link, it is a detour. A reader whose session is still being
 * restored keeps the keys link, because being wrong twice is worse than being
 * one click early: `/api-keys` asks for a sign-in by itself when it needs one.
 */
export function DocsHeader() {
  const status = useAuthStatus();

  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border/40 bg-background/70 px-4 backdrop-blur-xl">
      <Link
        href="/"
        className="flex items-center gap-1.5 text-sm font-medium tracking-tight transition-opacity hover:opacity-70"
      >
        <ClapperboardIcon className="size-4" />
        Play
      </Link>
      <span className="truncate text-sm text-muted-foreground">/ API reference</span>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {status === 'unauthenticated' ? (
          <Button asChild variant="ghost" size="sm">
            {/* Back to this page: whoever signs in from the reference came to
                read it, not to land in the studio. */}
            <Link href="/sign-in?next=/docs">
              <LogInIcon />
              Sign in
            </Link>
          </Button>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link href="/api-keys">
              <KeyRoundIcon />
              API keys
            </Link>
          </Button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
