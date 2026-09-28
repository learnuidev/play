'use client';

import Link from 'next/link';
import { ArrowRightIcon, BookOpenIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { listCourses } from '@/lib/api/v1';
import { useSession } from '@/lib/oauth/session';
import { useAsync } from '@/lib/use-async';
import { CourseCard } from '@/components/course-card';
import { RequestNote } from '@/components/request-note';
import { ConnectPrompt } from '@/components/connect-prompt';
import { ErrorPanel } from '@/components/error-panel';

/**
 * The classroom's front page: the courses this credential can read.
 *
 * One endpoint — `GET /v1/courses` — and what comes back is not "all the courses
 * in Play". It is the published ones, read as *the person who authorized this
 * app*, which for anyone who teaches here includes their own unpublished work.
 * That difference is the whole reason an app wants a person's permission rather
 * than a machine key: the same request answers differently for different people.
 */
export default function CoursesPage() {
  const { ready, signedIn, configured } = useSession();
  // Not attempted until there is a credential to attempt it with: `/v1` answers
  // 401 to a request with no token, and a 401 nobody can see is still a red line
  // in a console.
  const courses = useAsync(() => listCourses(), [signedIn], ready && signedIn);

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-12">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!configured || !signedIn) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-12">
        <ConnectPrompt what="the classroom" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">Classroom</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every course this credential can read — read with it, not with a key, so a course
            nobody has published is here when the person who authorized this app can read it.
          </p>
        </div>
      </div>

      {courses.loading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : courses.error ? (
        <ErrorPanel message={courses.error.message} onRetry={courses.reload} />
      ) : (courses.data ?? []).length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border/70 px-6 py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
            <BookOpenIcon className="size-5" />
          </div>
          <div className="max-w-md">
            <p className="text-lg font-medium tracking-tight">Nothing published yet</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              The catalog is empty for this account. Publish a course in Play&rsquo;s studio and it
              appears here — with no change to this app at all, which is the point.
            </p>
          </div>
          <Button asChild variant="secondary">
            <a
              href={`${process.env.NEXT_PUBLIC_PLAY_STUDIO_URL ?? 'http://localhost:3000'}/docs#catalog`}
              target="_blank"
              rel="noreferrer noopener"
            >
              How the catalog works
              <ArrowRightIcon />
            </a>
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(courses.data ?? []).map((course) => (
            <CourseCard key={course.spaceId} course={course} />
          ))}
        </div>
      )}

      <RequestNote endpoints={['GET /v1/courses?limit=24']} />
    </div>
  );
}
