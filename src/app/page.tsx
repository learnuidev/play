'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganizations } from '@/modules/organization/organization.queries';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The app has no standalone landing page: it opens the first organization you
 * belong to, and sends you to create one when you have none.
 */
export default function Home() {
  const router = useRouter();
  const { data, isLoading } = useOrganizations();
  const organizations = data?.organizations ?? [];

  useEffect(() => {
    if (isLoading) return;
    const first = organizations[0];
    router.replace(first ? `/o/${first.orgId}` : '/organizations/new');
  }, [isLoading, organizations, router]);

  return (
    <div className="flex min-h-svh items-center justify-center">
      <div className="grid w-full max-w-xs gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}
