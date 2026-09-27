"use client";

import Link from "next/link";
import { ClapperboardIcon, PlusIcon } from "lucide-react";
import { useOrganizations } from "@api/modules/organization/organization.queries";
import { cn } from "@ui/lib/utils";
import { Separator } from "@ui/components/ui/separator";
import { Skeleton } from "@ui/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ui/components/ui/tooltip";
import { OrgAvatar } from "./org-avatar";

/**
 * The narrow rail down the left edge: the product mark, then one avatar per
 * organization you belong to (the community switcher), then a shortcut to
 * create another.
 */
export function OrgRail({ activeOrgId }: { activeOrgId?: string }) {
  const { data, isLoading } = useOrganizations();
  const organizations = data?.organizations ?? [];

  return (
    <nav
      aria-label="Organizations"
      className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-border/40 bg-sidebar py-4 text-sidebar-foreground"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/"
            aria-label="Play home"
            className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            <ClapperboardIcon className="size-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Play</TooltipContent>
      </Tooltip>

      <Separator className="my-1 w-8" />

      <div className="px-2 flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-1">
        {isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="size-8 rounded-lg" />
            ))
          : organizations.map((organization) => {
              const active = organization.orgId === activeOrgId;
              return (
                <Tooltip key={organization.orgId}>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/o/${organization.orgId}`}
                      aria-label={organization.name}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-lg p-0.5 transition-all",
                        active ? "ring-2 ring-ring" : "hover:opacity-90",
                      )}
                    >
                      <OrgAvatar name={organization.name} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {organization.name}
                  </TooltipContent>
                </Tooltip>
              );
            })}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/organizations/new"
            aria-label="New organization"
            className="flex size-8 items-center justify-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
          >
            <PlusIcon className="size-3.5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">New organization</TooltipContent>
      </Tooltip>
    </nav>
  );
}
