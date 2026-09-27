'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClapperboardIcon } from 'lucide-react';
import { cn } from '@ui/lib/utils';
import { ThemeToggle } from '@ui/components/theme-toggle';
import { AccountMenu } from './account-menu';

/**
 * The pages that are not inside an organization: everything you have, and
 * everything waiting for you.
 *
 * There is no active community on any of them — that is the point of them — so
 * they get a plain header instead of the community shell. The four are one
 * family and are navigated between in one click, which is why the header is a
 * component rather than four copies of a header: a person who belongs to no
 * organization at all lives here, and this is the whole of their navigation.
 *
 * The API reference is deliberately not one of them. It is a document rather
 * than a surface — its own header, its own rail, read once and left — and it is
 * reached from the account menu, or from the keys screen it documents.
 */
const SURFACES = [
  { href: '/organizations', label: 'Organizations' },
  { href: '/spaces', label: 'Spaces' },
  { href: '/invites', label: 'Invites' },
  { href: '/api-keys', label: 'API keys' },
];

export function PlainShell({
  crumb,
  width = 'reading',
  children,
}: {
  /** The current page's name in the header, e.g. `Invites`. */
  crumb: string;
  /** `wide` for a wall of cards, `reading` for a column of prose. */
  width?: 'reading' | 'wide';
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 bg-background/70 px-4 backdrop-blur-xl">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm font-medium tracking-tight transition-opacity hover:opacity-70"
        >
          <ClapperboardIcon className="size-4" />
          Play
        </Link>
        <span className="text-sm text-muted-foreground">/ {crumb}</span>

        {/* The other two, and not the one you are on: a link to the page in front
            of you is a control that does nothing. */}
        <nav aria-label="Your account" className="ml-4 hidden items-center gap-3 sm:flex">
          {SURFACES.filter((surface) => !pathname.startsWith(surface.href)).map((surface) => (
            <Link
              key={surface.href}
              href={surface.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {surface.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>

      <main className="flex-1 bg-muted/40">
        <div
          className={cn(
            'mx-auto w-full px-6 py-10',
            width === 'wide' ? 'max-w-5xl' : 'max-w-3xl',
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
