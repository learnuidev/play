'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpenIcon,
  BuildingIcon,
  ChevronDownIcon,
  LinkIcon,
  PlusIcon,
  SettingsIcon,
} from 'lucide-react';
import { useOrganization } from '@/modules/organization/organization.queries';
import { useSpaces } from '@/modules/space/space.queries';
import { cn } from '@/lib/utils';
import { spaceAccentColor } from '@/components/space/space-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { OrgAvatar } from './org-avatar';

/** Spaces shown in the panel before it links out to the full list. */
const VISIBLE_SPACES = 8;

/**
 * The community's navigation panel: which organization you are in, the spaces
 * inside it, and secondary links.
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

  const { data: spaceData, isLoading: spacesLoading } = useSpaces(orgId);
  const spaces = spaceData?.spaces ?? [];
  // Viewers can read an organization but not add to it, so the affordance is
  // absent rather than present-and-rejected.
  const canCreate = organization ? organization.role !== 'VIEWER' : false;

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
                <OrgAvatar name={organization.name} size="sm" />
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
        <section className="grid gap-1">
          <h2 className="px-2.5 text-xs font-medium text-muted-foreground">Spaces</h2>

          {spacesLoading ? (
            <div className="grid gap-1 px-2.5 pt-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : spaces.length === 0 ? (
            <p className="px-2.5 text-xs leading-relaxed text-muted-foreground/80">
              No spaces yet. A space is a course: a title, how it unfolds, and the
              videos in it.
            </p>
          ) : (
            spaces.slice(0, VISIBLE_SPACES).map((space) => {
              const href = `${base}/spaces/${space.spaceId}`;
              const active = pathname === href;
              return (
                <Link
                  key={space.spaceId}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: spaceAccentColor(space) }}
                  />
                  <span className="truncate">{space.title}</span>
                </Link>
              );
            })
          )}

          {spaces.length > VISIBLE_SPACES && (
            <Link
              href={`${base}/spaces`}
              className="px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              All {spaces.length} spaces
            </Link>
          )}

          {canCreate && (
            <Link
              href={`${base}/spaces/new`}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <PlusIcon className="size-4 shrink-0" />
              <span className="truncate">New space</span>
            </Link>
          )}
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
    </aside>
  );
}
