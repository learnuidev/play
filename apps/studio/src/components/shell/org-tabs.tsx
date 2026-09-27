'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@ui/lib/utils';
import { lessonRoute } from '@/lib/routes';
import { ThemeToggle } from '@ui/components/theme-toggle';
import { AccountMenu } from './account-menu';

const TABS = [
  { segment: '', label: 'Home' },
  { segment: 'videos', label: 'Videos' },
  { segment: 'spaces', label: 'Spaces' },
  { segment: 'members', label: 'Members' },
] as const;

/**
 * Top bar of the community shell: a segmented control of sections, and who you
 * are, in one quiet band over the page.
 *
 * The tabs are a segmented control — a filled track with the section you are in
 * lifted out of it — rather than a row of underlined links, because where you
 * are is a property of the page you are on and reads better as one control than
 * as four destinations. The bar itself is translucent and bare: everything under
 * it is the point.
 */
export function OrgTabs({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const base = `/o/${orgId}`;

  // A lesson takes the whole window — it is watched and read rather than
  // navigated around, and a row offering Home, Videos, Spaces and Members above
  // a video is chrome nobody asked for. The sidebar already shows the course it
  // belongs to, and that is the way back.
  if (lessonRoute(pathname)) return null;

  return (
    <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-4 border-b border-border/40 bg-background/70 px-4 backdrop-blur-xl">
      <nav
        aria-label="Sections"
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-muted/70 p-0.5"
      >
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
                'shrink-0 rounded-full px-3.5 py-1 text-sm transition-colors',
                active
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <AccountMenu />
      </div>
    </div>
  );
}
