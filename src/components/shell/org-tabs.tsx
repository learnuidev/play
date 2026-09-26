'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { AccountMenu } from './account-menu';

const TABS = [
  { segment: '', label: 'Home' },
  { segment: 'videos', label: 'Videos' },
  { segment: 'spaces', label: 'Spaces' },
  { segment: 'members', label: 'Members' },
] as const;

/** Top bar of the community shell: section tabs on the left, account on the right. */
export function OrgTabs({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const base = `/o/${orgId}`;

  return (
    <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          // Home is only active on the bare org route, so the deeper tabs win.
          const active = tab.segment
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === base;
          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors',
                active
                  ? 'border bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <AccountMenu />
      </div>
    </div>
  );
}
