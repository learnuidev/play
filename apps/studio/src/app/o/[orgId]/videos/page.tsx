'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PlusIcon } from 'lucide-react';
import { useOrganization } from '@api/modules/organization/organization.queries';
import { Button } from '@ui/components/ui/button';
import { PageCard } from '@/components/shell/page-card';
import { VideoLibrary } from '@/components/video/video-library';

export default function OrganizationVideosPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { data } = useOrganization(orgId);
  const organization = data?.organization;
  const canUpload = organization ? organization.role !== 'VIEWER' : false;

  return (
    <PageCard
      title="Videos"
      description={
        organization ? `${organization.name} · visible to every member` : undefined
      }
      actions={
        canUpload ? (
          <Button size="sm" asChild>
            <Link href={`/o/${orgId}/videos/new`}>
              <PlusIcon />
              Upload video
            </Link>
          </Button>
        ) : undefined
      }
    >
      <VideoLibrary orgId={orgId} canUpload={canUpload} />
    </PageCard>
  );
}
