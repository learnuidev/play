'use client';

import { useParams } from 'next/navigation';
import { PageCard } from '@/components/shell/page-card';
import { SpaceForm } from '@/components/space/space-form';

export default function NewSpacePage() {
  const { orgId } = useParams<{ orgId: string }>();

  return (
    <PageCard
      title="New space"
      description="A course your organization publishes, and how its content unfolds."
    >
      <SpaceForm orgId={orgId} />
    </PageCard>
  );
}
