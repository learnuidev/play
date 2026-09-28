'use client';

import Link from 'next/link';
import { GraduationCapIcon } from 'lucide-react';
import { useMyCourses, useMyProgress } from '@play/api';
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
    <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">My learning</h1>
        <p className="mt-2 text-lg text-muted-foreground">
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
  const { data: progress } = useMyProgress(signedIn);
  const courses = data?.courses ?? [];

  /**
   * How far each course has got, by course.
   *
   * A course the API has not answered for yet — and one with nothing published
   * — is simply not in here, and its card shows no percentage and opens the
   * course page instead of a lesson. Nothing is guessed on the reader's behalf
   * in the meantime: a link to the wrong lesson, or a number about their own
   * work that is not theirs, is worse than a card that says less.
   */
  const progressBySpace = new Map(
    (progress?.courses ?? []).map((course) => [course.spaceId, course]),
  );

  if (isLoading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-64 rounded-3xl" />
        ))}
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <GraduationCapIcon className="size-6 text-muted-foreground/50" />
        <p className="text-lg font-medium tracking-tight">You are not taking anything yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Register for a course and it will appear here.
        </p>
        <Button asChild className="mt-2">
          <Link href="/discover">Discover courses</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <MyCourseCard
          key={course.space.spaceId}
          space={course.space}
          role={course.role}
          progress={progressBySpace.get(course.space.spaceId)}
        />
      ))}
    </div>
  );
}
