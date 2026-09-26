'use client';

import { useParams } from 'next/navigation';
import { LayoutGridIcon } from 'lucide-react';
import { EmptyState, PageCard } from '@/components/shell/page-card';

export default function OrganizationSpacesPage() {
  const { orgId } = useParams<{ orgId: string }>();

  return (
    <PageCard title="Spaces" description="Groups of courses and videos inside an organization.">
      <EmptyState
        icon={<LayoutGridIcon className="size-5 text-muted-foreground" />}
        title="Spaces are not built yet"
        description="Spaces will hold this organization's courses and organize its videos into sub-groups. Nothing here does anything yet."
      />
    </PageCard>
  );
}
