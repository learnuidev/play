'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftIcon, ExternalLinkIcon, UserXIcon } from 'lucide-react';
import { ApiError, useCatalogInstructor } from '@play/api';
import { PersonAvatar } from '@play/ui';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { SOCIAL_KEYS, SOCIAL_LABELS } from '@play/types';
import { CourseTile } from '@/components/course-tile';
import { useEnrolledSpaceIds } from '@/components/use-enrolled';

/**
 * What the line under the name says.
 *
 * Counted rather than assumed: somebody can have a profile and nothing listed
 * yet, and "Teaches 0 courses" is a sentence no page should print.
 */
function teachingLine(count: number): string {
  if (count === 0) return 'Teaches on Play';
  if (count === 1) return 'Teaches one course on Play Marketplace';
  return `Teaches ${count} courses on Play Marketplace`;
}

/**
 * One instructor: who they are, and what they teach here.
 *
 * A person's page rather than a course's, which is why it is not part of a
 * course route. The same name teaches in several courses and possibly in several
 * communities, and a reader who liked one course wants the rest of them — the
 * alternative is a marketplace where the only way to find out what else somebody
 * made is to stumble across it.
 *
 * Everything here comes from two places, and neither of them needs a session:
 * the profile the person wrote about themselves, and the catalog's own list of
 * what they teach. Public, like the course page that links here, and for the
 * same reason — the reader is deciding whether to register.
 */
export default function InstructorPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useCatalogInstructor(id);
  const enrolled = useEnrolledSpaceIds();

  // The API answers 404 for an id that teaches nothing here and has no profile.
  // That is a page state, not a failure: somebody following a stale link should
  // be told plainly, not shown a retry.
  const missing = error instanceof ApiError && error.status === 404;

  if (missing) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 py-24 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted/60">
          <UserXIcon className="size-5 text-muted-foreground" />
        </span>
        <p className="text-lg font-medium tracking-tight">No such instructor</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Nobody teaches under this link. It may be out of date, or the person may have stopped
          teaching.
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link href="/discover">Discover courses</Link>
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <p className="mx-auto w-full max-w-6xl px-4 py-12 text-sm text-destructive">
        {error instanceof Error ? error.message : 'Could not load this instructor'}
      </p>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12">
        <Skeleton className="h-24 w-24 rounded-full" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-20 w-full max-w-2xl rounded-2xl" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="aspect-[4/3] rounded-3xl" />
          <Skeleton className="aspect-[4/3] rounded-3xl" />
        </div>
      </div>
    );
  }

  const { instructor, courses } = data;
  const links = SOCIAL_KEYS.filter((key) => instructor.socials[key]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <Link
        href="/discover"
        className="inline-flex items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        All courses
      </Link>

      <header className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        <PersonAvatar name={instructor.name} photoUrl={instructor.photoUrl} size="xl" />

        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{instructor.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{teachingLine(courses.length)}</p>

          {instructor.bio && (
            /* Their own words, as text. Nothing a profile says is ever parsed as
               markup — it is the one field on this page somebody else wrote. */
            <p className="mt-5 max-w-2xl whitespace-pre-line text-base leading-relaxed text-muted-foreground">
              {instructor.bio}
            </p>
          )}

          {links.length > 0 && (
            <ul className="mt-5 flex flex-wrap items-center gap-2">
              {links.map((key) => (
                <li key={key}>
                  <a
                    href={instructor.socials[key]}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {SOCIAL_LABELS[key]}
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <section className="mt-12 grid gap-4">
        <h2 className="text-base font-semibold tracking-tight">Courses</h2>

        {courses.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 px-5 py-10 text-center text-sm text-muted-foreground">
            Nothing published right now. Courses appear here as they are listed on the marketplace.
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <CourseTile
                key={course.spaceId}
                course={course}
                enrolled={enrolled.has(course.spaceId)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
