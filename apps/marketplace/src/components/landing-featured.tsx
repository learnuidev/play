'use client';

import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';
import { useCatalogCourses } from '@play/api';
import { Skeleton } from '@ui/components/ui/skeleton';
import { CourseTile } from '@/components/course-tile';
import { Reveal } from '@/components/reveal';
import { useEnrolledSpaceIds } from '@/components/use-enrolled';

/** How many courses the front page shows before sending you to Discover. */
const SHOWN = 3;

/**
 * The first few courses on the marketplace, read from the catalog itself.
 *
 * The front page is otherwise words about the product, and words about a
 * marketplace are worth less than three of the things it sells. This is the one
 * block that is not a claim: whatever its author has published, right now,
 * drawn with the same tile Discover draws it with.
 *
 * It shows nothing at all when there is nothing to show — while the catalog is
 * still on its way, while it is empty, and when it cannot be reached. A front
 * page that opens with an empty shelf is a worse answer than one that simply
 * does not mention shelves, and the visitor who is curious has Discover behind
 * the one link either way.
 */
export function FeaturedCourses() {
  const { data, isLoading, isError } = useCatalogCourses();
  const enrolled = useEnrolledSpaceIds();
  const courses = (data?.courses ?? []).slice(0, SHOWN);

  if (isError || (!isLoading && courses.length === 0)) return null;

  return (
    <section className="mx-auto mt-24 w-full max-w-6xl px-4 sm:mt-28">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              New on the marketplace
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              The latest courses published by communities on Play.
            </p>
          </div>

          <Link
            href="/discover"
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Discover all
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
      </Reveal>

      {/* The frames stand in the size of the tiles rather than the size of a
          line: a row of skeletons is what the row is about to be. */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: SHOWN }).map((_, index) => (
              <div
                key={index}
                className="grid gap-3 overflow-hidden rounded-3xl border border-border/60 bg-card"
              >
                <Skeleton className="aspect-video w-full rounded-none" />
                <div className="grid gap-2 px-5 pb-5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))
          : courses.map((course, index) => (
              <Reveal key={course.spaceId} delay={index * 60} className="h-full">
                <CourseTile course={course} enrolled={enrolled.has(course.spaceId)} />
              </Reveal>
            ))}
      </div>
    </section>
  );
}
