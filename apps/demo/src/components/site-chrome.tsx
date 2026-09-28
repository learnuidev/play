'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOutIcon, PlayIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { useSession } from '@/lib/oauth/session';

/**
 * This app's own bar — and deliberately not Play's.
 *
 * The two apps in this repository share a header because they are one product.
 * This one is not: it is somebody else's software that happens to read Play, so
 * it wears its own name, its own wordmark and its own accent, and the only thing
 * it says about Play is the badge that opens the sign-in. A demo that looked
 * exactly like the studio would be demonstrating nothing.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { signedIn, ready, signOut } = useSession();

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-border/40 bg-background/70 px-4 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
          <span className="flex size-6 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <PlayIcon className="size-3.5" />
          </span>
          Fieldnotes
        </Link>
        <span className="hidden rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground sm:inline">
          Built on the Play API
        </span>

        <nav className="ml-4 hidden items-center gap-3 sm:flex">
          {pathname !== '/courses' && (
            <Link
              href="/courses"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Classroom
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {ready && signedIn && (
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOutIcon />
              Disconnect
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border/40 px-4 py-6">
        <p className="mx-auto max-w-5xl text-xs leading-relaxed text-muted-foreground">
          Fieldnotes is a demo: a third-party app that signs people in with Play and reads the
          public API with the token it is given. It has no database and no sign-in of its own, and
          it is not built by Play — that is the point of it.
        </p>
      </footer>
    </div>
  );
}
