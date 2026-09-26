import Link from 'next/link';
import { ClapperboardIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { AccountMenu } from '@/components/shell/account-menu';

/**
 * Layout for the pages that sit outside any organization — the organization
 * list and the create form. There is no active community here, so they get a
 * plain header instead of the community shell.
 */
export default function OrganizationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ClapperboardIcon className="size-4" />
          </span>
          Play
        </Link>
        <span className="text-sm text-muted-foreground">/ Organizations</span>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>
      <main className="flex-1 bg-muted/30">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
