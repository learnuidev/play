'use client';

import { usePathname } from 'next/navigation';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { lessonRoute } from '@/lib/routes';
import { CommunitySidebar } from './community-sidebar';
import { OrgRail } from './org-rail';
import { OrgTabs } from './org-tabs';

/**
 * The three-column community frame: the organization rail, the community's
 * navigation panel, and the tabbed main area.
 *
 * `SidebarProvider` is kept so the design-system sidebar primitives (and their
 * keyboard shortcut) behave normally inside the panel; the rail and the panel
 * are laid out as ordinary flex columns rather than a collapsible sidebar,
 * because both are always visible in this layout.
 *
 * A lesson keeps only the main area: no tab bar, no organization rail, and no
 * column beside it. A classroom is watched rather than browsed, and a column of
 * navigation costs the video its width for as long as the page is open — the
 * course it belongs to is one of the lesson's own tabs now, and the link back
 * to the space sits at the top of the page.
 */
export function AppShell({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const lesson = lessonRoute(pathname);

  return (
    <SidebarProvider>
      <div className="flex h-svh w-full overflow-hidden">
        {!lesson && <OrgRail activeOrgId={orgId} />}
        {!lesson && <CommunitySidebar orgId={orgId} />}
        <SidebarInset className="min-w-0 bg-muted/30">
          <OrgTabs orgId={orgId} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* A lesson is split down the middle — the video on one side, the
                tabs beside it — so it gets the window's width rather than the
                reading measure the rest of the app is set to. Still bounded:
                past this the two halves stop being a pair. */}
            <div
              className={cn(
                'mx-auto w-full px-6 py-6',
                lesson ? 'h-full max-w-[1600px]' : 'max-w-5xl',
              )}
            >
              {children}
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
