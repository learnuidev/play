import Link from 'next/link';
import { ClapperboardIcon, KeyRoundIcon } from 'lucide-react';
import { ThemeToggle } from '@ui/components/theme-toggle';
import { Button } from '@ui/components/ui/button';

/**
 * The reference's own header.
 *
 * Not the app's: the pages behind the sidebar are the product, and a reference
 * is something else — you arrive at it from a key you just made, read one
 * section, and leave. So it keeps the mark, a way back, and one link to the
 * screen that issues the credential every example needs.
 */
export function DocsHeader() {
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
        <Button asChild variant="ghost" size="sm">
          <Link href="/api-keys">
            <KeyRoundIcon />
            API keys
          </Link>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
