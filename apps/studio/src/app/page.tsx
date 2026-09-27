'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganizations } from '@api/modules/organization/organization.queries';
import { useMyCourses } from '@api/modules/space-member/space-member.queries';
import { Skeleton } from '@ui/components/ui/skeleton';

/**
 * The app has no standalone landing page: it opens the first organization you
 * belong to, and sends you to create one when you have none.
 *
 * A course can be taken by somebody who belongs to no organization at all, so
 * "you have none" is not the same as "you have nothing": a person taking a
 * single course they were invited to is sent to the courses they can open rather
 * than to a form for creating a community they never asked for.
 */
export default function Home() {
  const router = useRouter();
  const { data, isLoading } = useOrganizations();
  const { data: coursesData, isLoading: coursesLoading } = useMyCourses();

  const organizations = data?.organizations ?? [];
  const courses = coursesData?.courses ?? [];
  // Both reads decide where this lands, so neither may be assumed empty: an
  // organization list that has arrived before the course list would send a
  // course-only learner to the create form.
  const loading = isLoading || coursesLoading;

  useEffect(() => {
    if (loading) return;

    const first = organizations[0];
    if (first) {
      router.replace(`/o/${first.orgId}`);
      return;
    }

    router.replace(courses.length > 0 ? '/spaces' : '/organizations/new');
  }, [loading, organizations, courses, router]);

  return (
    <div className="flex min-h-svh items-center justify-center">
      <div className="grid w-full max-w-xs gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}
