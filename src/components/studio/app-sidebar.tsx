'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { BuildingIcon, ClapperboardIcon, FilmIcon, LogOutIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';

export function AppSidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuthenticator((context) => [context.user, context.signOut]);

  const email = user?.signInDetails?.loginId ?? user?.username ?? '';

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/studio">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <ClapperboardIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Play</span>
                  <span className="truncate text-xs text-muted-foreground">Studio</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={pathname === '/studio'} asChild>
                <Link href="/studio">
                  <FilmIcon />
                  <span>Videos</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Organizations</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive={pathname.startsWith('/studio/organizations')} asChild>
                <Link href="/studio/organizations">
                  <BuildingIcon />
                  <span>All organizations</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-medium">{email}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOutIcon />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
