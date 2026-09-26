'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpenIcon,
  BuildingIcon,
  ChevronDownIcon,
  HomeIcon,
  LinkIcon,
  PlusIcon,
  SettingsIcon,
} from 'lucide-react';
import { useOrganization } from '@/modules/organization/organization.queries';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { OrgAvatar } from './org-avatar';

/**
 * The community's navigation panel: which organization you are in, the section
 * list, the spaces inside it, and secondary links.
 *
 * Sections that have no backing feature yet say so rather than offering
 * controls that do nothing.
 */
export function CommunitySidebar({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const { data, isError } = useOrganization(orgId);
  const organization = data?.organization;
  const base = `/o/${orgId}`;
  // A bad organization id in the URL should read as missing, not spin forever.
  const name = organization?.name ?? (isError ? 'Not found' : 'Loading…');

  return (
    <aside
      aria-label="Community navigation"
      className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex"
    >
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {organization ? (
                <OrgAvatar orgId={organization.orgId} name={organization.name} size="sm" />
              ) : isError ? (
                <div className="size-7 shrink-0 rounded-lg border border-dashed" />
              ) : (
                <Skeleton className="size-7 rounded-lg" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem asChild>
              <Link href={`${base}/settings`}>
                <SettingsIcon />
                Organization settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/organizations">
                <BuildingIcon />
                All organizations
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/organizations/new">
                <PlusIcon />
                New organization
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pb-3">
        <nav className="grid gap-0.5">
          <Link
            href={base}
            aria-current={pathname === base ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
              pathname === base
                ? 'bg-sidebar-primary font-medium text-sidebar-primary-foreground'
                : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <HomeIcon className="size-4 shrink-0" />
            <span className="truncate">Home</span>
          </Link>
        </nav>

        <section className="grid gap-2">
          <h2 className="px-2.5 text-xs font-medium text-muted-foreground">Spaces</h2>
          <p className="px-2.5 text-xs leading-relaxed text-muted-foreground/80">
            No spaces yet. Spaces will hold this organization&apos;s courses and
            videos.
          </p>
        </section>

        <section className="grid gap-1">
          <h2 className="flex items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground">
            <LinkIcon className="size-3" />
            Links
          </h2>
          <Link
            href={`${base}/videos`}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <BookOpenIcon className="size-4 shrink-0" />
            <span className="truncate">Video library</span>
          </Link>
          <Link
            href={`${base}/settings`}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <SettingsIcon className="size-4 shrink-0" />
            <span className="truncate">Organization settings</span>
          </Link>
        </section>
      </div>

      <div className="border-t p-3">
        <Button variant="outline" size="sm" className="w-full justify-start" asChild>
          <Link href="/organizations/new">
            <PlusIcon />
            New organization
          </Link>
        </Button>
      </div>
    </aside>
  );
}
