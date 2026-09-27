'use client';

import { useEffect, useMemo, useState } from 'react';
import { SearchXIcon, SparklesIcon } from 'lucide-react';
import { useCatalogCourses } from '@play/api';
import { Button } from '@ui/components/ui/button';
import { Skeleton } from '@ui/components/ui/skeleton';
import { cn } from '@ui/lib/utils';
import { CourseTile } from '@/components/course-tile';
import { CourseSearch } from '@/components/course-search';
import { useEnrolledSpaceIds } from '@/components/use-enrolled';
import type { CatalogCourse } from '@play/types';

/** The filter that means "everything", rather than a community's name. */
const ALL = 'All';

/**
 * The front page: everything published, and one box to look through it with.
 *
 * It reads as a storefront rather than a list — a statement, a search, the
 * communities the courses come from, and then the courses themselves as tiles.
 * Browsing is public; nothing here asks who anybody is.
 */
export default function CatalogPage() {
  /**
   * Two pieces of state, because they are two different things: what is in the
   * box, and what is being shown. Typing changes the first and searching changes
   * the second — the catalog does not re-query on every letter, which is both
   * what was asked for and the honest thing to do against an API whose search
   * reads the whole catalog behind it.
   */
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  /** Which community's courses are being shown, or all of them. */
  const [community, setCommunity] = useState(ALL);

  /** Typed but not yet searched: worth a nudge, not worth a request. */
  const unsent = draft.trim() !== search;

  const { data, isLoading, isPlaceholderData, isError, error } = useCatalogCourses(search);
  const enrolled = useEnrolledSpaceIds();

  const courses = data?.courses ?? [];

  const communities = useMemo(
    () => [...new Set(courses.map((course) => course.organizationName))].sort(),
    [courses],
  );

  // A community picked while looking at one set of results should not silently
  // filter the next: searching for something else is a new question.
  useEffect(() => {
    if (community !== ALL && !communities.includes(community)) setCommunity(ALL);
  }, [communities, community]);

  /**
   * A search is a thing you can send somebody.
   *
   * Written to the URL rather than into the router: the page is static, and a
   * navigation per keystroke would fill the back button with the letters of a
   * word. Reading it once on mount is what makes a shared link open on its
   * results.
   */
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get('q');
    if (shared) {
      setDraft(shared);
      setSearch(shared);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (search) params.set('q', search);
    else params.delete('q');
    const rest = params.toString();
    window.history.replaceState(null, '', rest ? `/?${rest}` : '/');
  }, [search]);

  const visible =
    community === ALL ? courses : courses.filter((course) => course.organizationName === community);

  return (
    <div className="pb-24">
      <Hero
        query={draft}
        onQueryChange={setDraft}
        onSearch={() => setSearch(draft.trim())}
        unsent={unsent}
        courses={courses}
        communities={communities}
        searching={search}
      />

      <section className="mx-auto w-full max-w-6xl px-4">
        {communities.length > 1 && (
          <div className="mb-10 flex flex-wrap justify-center gap-2">
            {[ALL, ...communities].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setCommunity(name)}
                aria-pressed={name === community}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm transition-colors',
                  name === community
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {name === ALL ? 'All courses' : name}
              </button>
            ))}
          </div>
        )}

        {/* The heading names what is being looked at before the answer arrives,
            so it does not appear with the results and push them down. */}
        {!isError && (
          <SectionHeading
            title={search ? `Results for “${search}”` : 'All courses'}
            detail={headingDetail(courses.length, visible.length, community)}
            // The count is the only half that waits: it belongs to an answer
            // that has not arrived, while the question was asked a moment ago.
            loading={isLoading || isPlaceholderData}
          />
        )}

        {/* A stage with a floor under it. A search that matches nothing is a much
            shorter answer than the grid it replaces, and without this the footer
            — and everything else below — jumps up the page the moment the results
            arrive. Roughly one row of tiles: what the eye is already holding. */}
        <div className="min-h-96">
          {isError ? (
            <Notice
              title="The catalog could not be loaded"
              body={error instanceof Error ? error.message : 'Something went wrong on the way.'}
            />
          ) : isLoading ? (
            <GridSkeleton />
          ) : courses.length === 0 ? (
            search ? (
              <Notice
                title={`No courses match “${search}”`}
                body="Try a different word, or look through everything published so far."
                action={
                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      setDraft('');
                      setSearch('');
                    }}
                  >
                    Clear search
                  </Button>
                }
              />
            ) : (
              <Notice
                title="Nothing is published yet"
                body="Courses appear here the moment their authors list them in Play Studio."
              />
            )
          ) : (
            <div
              className={cn(
                'grid gap-6 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3',
                // Still the previous search's results: shown, but faded, so the
                // page does not empty itself out while the answer is on its way.
                isPlaceholderData && 'opacity-50',
              )}
            >
              {visible.map((course) => (
                <Tile key={course.spaceId} course={course} enrolled={enrolled.has(course.spaceId)} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The top of the page: a statement, a search box, and what is behind them.
 *
 * Centred and generous with space, because there is exactly one thing to do here
 * and it is the box in the middle.
 */
function Hero({
  query,
  onQueryChange,
  onSearch,
  unsent,
  courses,
  communities,
  searching,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  onSearch: () => void;
  /** Whether the box holds something that has not been searched for yet. */
  unsent: boolean;
  courses: CatalogCourse[];
  communities: string[];
  /** What is being shown, which the hero's own count line follows. */
  searching: string;
}) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* A soft wash of the app's one accent behind the statement. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 h-72 bg-gradient-to-b from-emerald-500/12 via-transparent to-transparent blur-3xl"
      />

      <div className="mx-auto w-full max-w-2xl px-4 pt-16 pb-12 text-center sm:pt-24 sm:pb-16">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <SparklesIcon className="size-3.5" />
          Play Marketplace
        </p>

        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
          Courses worth your evening.
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground sm:text-xl">
          Made by communities on Play. Read what a course covers, register in a click, and take it
          here.
        </p>

        <div className="mx-auto mt-8 max-w-md">
          <CourseSearch value={query} onChange={onQueryChange} onSubmit={onSearch} />
        </div>

        {/* One line, always, even when it is saying nothing: this is where the
            page would otherwise grow and shrink under the search box. What a
            search is showing belongs to the heading below, not here. */}
        <p className="mt-4 min-h-6 text-sm text-muted-foreground">
          {unsent
            ? `Press Enter to search for “${query.trim()}”`
            : !searching && courses.length > 0
              ? `${courses.length} course${courses.length === 1 ? '' : 's'}${
                  communities.length > 1 && ` from ${communities.length} communities`
                }`
              : ''}
        </p>
      </div>
    </section>
  );
}

/**
 * What the heading says on the right: how many courses are on screen.
 *
 * Nothing at all when there is nothing to count. A search that matches nothing
 * says so underneath, in a sentence; "0 courses" beside the title would be the
 * same fact told twice, once as a number.
 */
function headingDetail(total: number, shown: number, community: string): string {
  if (total === 0) return '';

  return community === ALL
    ? `${shown} course${shown === 1 ? '' : 's'}`
    : `${shown} from ${community}`;
}

/**
 * A quiet heading over a grid, with what is in it on the right.
 *
 * The title says what is being looked at — a search the moment it is asked for,
 * the catalog otherwise — and does not wait for anything to arrive. The count
 * does wait: it belongs to an answer that is still on its way, and the previous
 * answer's number is one that looks like an answer and is not one.
 */
function SectionHeading({
  title,
  detail,
  loading,
}: {
  title: string;
  detail: string;
  loading: boolean;
}) {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>

      {loading ? (
        // The height of the line it stands in, so the grid below does not move
        // when the number arrives.
        <Skeleton className="h-5 w-16" />
      ) : (
        <p className="shrink-0 text-sm text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}

/** One tile, arriving rather than appearing. */
function Tile({ course, enrolled }: { course: CatalogCourse; enrolled: boolean }) {
  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <CourseTile course={course} enrolled={enrolled} />
    </div>
  );
}

/** What a page says when it has nothing to show, and what to do about it. */
function Notice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <SearchXIcon className="size-6 text-muted-foreground/50" />
      <p className="text-lg font-medium tracking-tight">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {/* One row, which is what the floor under this is sized to. */}
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="grid gap-3 rounded-3xl border bg-card p-0">
          <Skeleton className="aspect-video w-full rounded-t-3xl rounded-b-none" />
          <div className="grid gap-2 px-4 pb-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
