'use client';

import { useParams } from 'next/navigation';
import { PageCard } from '@/components/shell/page-card';
import { UploadForm } from '@/components/video/upload-form';

export default function NewVideoPage() {
  const { orgId } = useParams<{ orgId: string }>();

  return (
    <PageCard
      title="Upload a video"
      description="It will be encoded, transcribed, and added to this organization's library."
    >
      <UploadForm organizationId={orgId} />
    </PageCard>
  );
}
