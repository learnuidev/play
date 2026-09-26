'use client';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
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
 */
export function AppShell({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-svh w-full overflow-hidden">
        <OrgRail activeOrgId={orgId} />
        <CommunitySidebar orgId={orgId} />
        <SidebarInset className="min-w-0 bg-muted/30">
          <OrgTabs orgId={orgId} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl px-6 py-6">{children}</div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
