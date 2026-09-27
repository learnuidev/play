'use client';

import Link from 'next/link';
import { GraduationCapIcon, SignpostIcon } from 'lucide-react';
import { useMyCourses } from '@play/api';
import { AuthGate, useIsSignedIn } from '@play/auth';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { MyCourseCard } from '@/components/my-course-card';

/**
 * The courses this reader is taking.
 *
 * Read from their memberships rather than from the catalog, because the two are
 * different questions: a course somebody was invited to and registered for is
 * theirs whether or not its author ever listed it in public.
 */
export default function MyCoursesPage() {
  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">My learning</h1>
        <p className="text-sm text-muted-foreground">
          The courses you are registered for, wherever they came from.
        </p>
      </header>

      {/* The one page here that is entirely about you: it opens with a sign-in
          rather than a register button, because there is nothing to read first. */}
      <AuthGate>
        <EnrolledCourses />
      </AuthGate>
    </div>
  );
}

function EnrolledCourses() {
  const signedIn = useIsSignedIn();
  const { data, isLoading } = useMyCourses(signedIn);
  const courses = data?.courses ?? [];

  if (isLoading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-64 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/20 px-6 py-16 text-center">
        <GraduationCapIcon className="size-5 text-muted-foreground/60" />
        <p className="text-sm font-medium">You are not taking anything yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Browse the catalog and register for a course — it will appear here.
        </p>
        <Button asChild className="mt-2">
          <Link href="/">
            <SignpostIcon />
            Browse courses
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <MyCourseCard key={course.space.spaceId} space={course.space} role={course.role} />
      ))}
    </div>
  );
}
