'use client';

import Link from 'next/link';
import { BuildingIcon } from 'lucide-react';
import { ORG_ROLE_LABELS, type OrganizationSummary } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const ROLE_VARIANT = {
  ADMIN: 'default',
  EDITOR: 'secondary',
  VIEWER: 'outline',
} as const;

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function OrganizationCard({ organization }: { organization: OrganizationSummary }) {
  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-5 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-xl">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/40">
          <BuildingIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/o/${organization.orgId}`}
            className="line-clamp-1 text-sm font-semibold transition-colors hover:underline"
          >
            {organization.name}
          </Link>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{organization.slug}</p>
        </div>
        <Badge variant={ROLE_VARIANT[organization.role]}>{ORG_ROLE_LABELS[organization.role]}</Badge>
      </div>

      <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
        {organization.description || 'No description'}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Created {formatDate(organization.createdAt)}
        </span>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/o/${organization.orgId}`}>Open</Link>
        </Button>
      </div>
    </article>
  );
}
