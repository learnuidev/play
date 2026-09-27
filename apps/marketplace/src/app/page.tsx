'use client';

import { CompassIcon } from 'lucide-react';
import { useCatalogCourses } from '@play/api';
import { Skeleton } from '@ui/components/ui/skeleton';
import { CourseCard } from '@/components/course-card';
import { useEnrolledSpaceIds } from '@/components/use-enrolled';

/**
 * The front page: every course its author has published.
 *
 * Public on purpose — no account, no onboarding, no wall between a reader and
 * the thing they came to look at. Registering is what asks for a sign-in, and
 * only at the moment somebody decides to take a course.
 */
export default function CatalogPage() {
  const { data, isLoading, isError, error } = useCatalogCourses();
  const courses = data?.courses ?? [];
  const enrolled = useEnrolledSpaceIds();

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Learn something worth your evening.
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Courses published by communities on Play. Read what a course covers, register for it, and
          take it here — the lessons, the transcript, the notes and the discussion.
        </p>
      </section>

      {isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Could not load the catalog'}
        </p>
      ) : isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/20 px-6 py-16 text-center">
          <CompassIcon className="size-5 text-muted-foreground/60" />
          <p className="text-sm font-medium">No courses are published yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Courses appear here once their authors list them in Play Studio.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <CourseCard
              key={course.spaceId}
              course={course}
              enrolled={enrolled.has(course.spaceId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
